# MyGateway 详细设计

本文记录需要跨模块理解的复杂能力。目前包括多协议路由、Chat / Messages 转换、供应商
预制和 Provider 专属查询。通用系统结构见 [ARCHITECTURE](ARCHITECTURE.md)。

## 1. 多协议渠道

MyGateway 对外提供三种生成协议：

| 协议标识 | 客户端入口 | Provider 路径 |
|---|---|---|
| `openai_chat` | `/v1/chat/completions` | `/chat/completions` |
| `openai_responses` | `/v1/responses` | `/responses` |
| `anthropic_messages` | `/v1/messages` | `/messages` |

一个渠道保存一份 Provider Key，并通过 `channel_protocols` 配置一个或多个原生端点。每个端点
独立声明：

- 协议类型；
- Base URL；
- `bearer` 或 `x_api_key` 鉴权；
- Messages 所需的可选 API version。

Provider Key 不在协议记录中复制，避免同一供应商的多个协议出现密钥漂移。

## 2. 协议候选选择

对每个客户端请求，系统先解析统一模型或完整别名，再对候选渠道执行协议选择：

```text
客户端协议
  → 候选是否有同协议原生端点？
      → 有：使用原生端点
      → 无：是否存在明确支持的转换？
          → Chat ↔ Messages：检查请求是否属于公共子集
          → Responses：无转换路径
  → 按模型实例固定顺序执行 Fallback
```

原则：

- 原生协议始终优先于转换；
- 协议能力属于“渠道端点”，不是仅由 `provider_type` 推测；
- 未配置的能力默认不可用；
- 完整公开别名仍只访问指定渠道；
- 无匹配协议返回 `unsupported_protocol`；
- 存在转换路径但字段不能无损表达时返回 `unsupported_protocol_feature`。

## 3. Chat / Messages 转换

第一阶段只实现高频公共子集。

### 3.1 请求

| 能力 | Chat → Messages | Messages → Chat |
|---|---|---|
| `model` | 支持 | 支持 |
| 文本消息 | 支持 | 支持 |
| system 指令 | `system` message → Messages `system` | Messages `system` → system message |
| `max_tokens` | 支持 | 支持 |
| temperature / top_p | 支持 | 支持 |
| stop | 支持 | 支持 |
| function tools | 支持 | 支持 |
| tool choice | 公共模式支持 | 公共模式支持 |
| tool call / tool result | 支持 | 支持 |
| stream | 支持 | 支持 |

暂不转换图片、音频、文件、Hosted tools、thinking、prompt caching 和 Provider 专属扩展。
检测到这些字段时明确报错，不静默删除。

### 3.2 非流式响应

转换层映射：

- assistant 文本；
- tool calls / `tool_use`；
- finish reason / stop reason；
- input、output 和 total token usage；
- 请求模型和基础响应 ID。

Provider 返回的不可信 usage 不会被修复或估算。Messages 没有 `total_tokens` 字段时按协议
要求拆分 input/output；网关内部统计仍使用统一结构。

### 3.3 SSE

转换器建立在共享增量 SSE decoder 上，不直接按网络 chunk 替换字符串。

Chat → Messages 生成的主要事件：

```text
message_start
content_block_start
content_block_delta
content_block_stop
message_delta
message_stop
```

Messages → Chat 生成标准 `chat.completion.chunk`，并以 `data: [DONE]` 结束。工具参数可以跨
多个增量事件，转换器保留其顺序，不要求每个分片自身是完整 JSON。

如果上游在已经提交 SSE 后失败，只终止当前流并记录未知用量，不切换到其他渠道。

### 3.4 错误

- 转换前发现不支持字段：返回网关统一错误；
- 上游尚未响应时出现可回退故障：可以尝试下一渠道；
- 上游返回协议错误：保留可用的 HTTP 状态并清理敏感正文；
- 流已经开始后转换失败：终止流，不拼接另一个 Provider 的回答。

## 4. Responses 边界

`/v1/responses` 当前只转发到配置了 `openai_responses` 的原生端点，不执行 Responses ↔ Chat
或 Responses ↔ Messages 转换。

这样可以避免在尚未定义 Hosted tools、item、reasoning、文件和多模态语义时生成“看起来
成功但已经丢能力”的响应。

## 5. 供应商预制

Worker 与 Dashboard 共用 `src/shared/provider-presets.ts`。该文件是供应商名称、Base URL、
文档链接和协议端点的代码权威来源；本文只记录能力概览。

| 供应商 | 预制原生协议 |
|---|---|
| OpenAI | Chat、Responses |
| Anthropic | Messages |
| DeepSeek | Chat、Messages |
| Z.AI | Chat |
| 华为云（中国） | Chat、Messages |
| 阿里云国际 | Chat、Messages |
| 火山国际（BytePlus） | Chat、Responses |
| Google Gemini | Chat |
| Groq | Chat、Responses |
| MiniMax 国际 | Chat、Messages |
| xAI | Chat、Responses |
| Mistral AI | Chat |

预制遵循：

- 只声明供应商官方文档确认的兼容端点；
- 通用按量 API 与 Coding Plan 等专属入口不混用；
- 一次输入 Key 创建同渠道的所有已知协议；
- 后续供应商差异通过显式 Adapter 扩展，不把未知 Provider 猜成已有类型。

## 6. DeepSeek 官方余额

### 6.1 支持边界

余额只对主机名严格等于 `api.deepseek.com` 的官方渠道开放。第三方托管的 DeepSeek 模型
不会使用其 Key 请求 DeepSeek 官方接口。

Worker 调用：

```http
GET https://api.deepseek.com/user/balance
Authorization: Bearer <provider-key>
```

官方响应中的 `CNY` / `USD` 金额以字符串验证和展示，避免 JavaScript 浮点数改变精度。
余额是 Provider 账户维度，不等于 Token 套餐，也不能跨渠道或币种求和。

### 6.2 管理 API

| 路径 | 行为 |
|---|---|
| `GET /admin/api/channels/balances` | 仅读取当前 isolate 缓存；未查询返回 `not_queried` |
| `GET /admin/api/channels/balances?refresh=1` | 主动刷新支持的渠道 |
| `GET /admin/api/channels/:id/balance` | 单渠道缓存优先查询 |
| `GET /admin/api/channels/:id/balance?refresh=1` | 强制刷新单渠道 |

Dashboard 刷新附带 `active=1`，不会查询停用渠道。Channels 页面允许管理员显式刷新单个
渠道。

### 6.3 缓存与失败

- 成功结果在当前 Worker isolate 缓存 5 分钟，最多 200 个渠道；
- 浏览器保留当前会话最后一次成功或失败的查询结果；后续其他 isolate 返回的 `not_queried`
  不能覆盖已经展示的刷新结果，显式刷新返回的新成功或错误仍会替换旧值；
- 同渠道并发查询合并为一次 Provider 请求；
- 更新或删除渠道立即使当前 isolate 缓存失效；
- 配置更新期间尚未完成的旧 Key 查询不能回填缓存；
- 请求超时 10 秒，响应体上限 64 KiB；
- 上游错误只返回清理后的说明，不回显正文或 Key；
- 查询失败不影响渠道路由和模型请求。

该能力不写 D1/KV/DO，也不由 Cron 主动执行。isolate 回收后服务端状态回到 `not_queried`；
当前浏览器会话仍保留其最后一次已解析结果，属于不增加共享状态成本的尽力缓存行为。

DeepSeek 接口定义：<https://api-docs.deepseek.com/zh-cn/api/get-user-balance>。

## 7. 渠道模型发现与导入

### 7.1 两层模型数据

供应商模型库存与网关路由必须分离：渠道库存记录 Provider 当前可见或管理员手工补充的
模型；`model_cards` 和 `channel_models` 仍是对外统一模型与实际路由的唯一权威数据。
刷新库存不得自动创建、删除或停用路由。

### 7.2 发现适配器

预制供应商使用经官方文档确认的模型列表路径、认证协议和分页例外；大多数
OpenAI-compatible 预制共用标准 `GET /models` 适配器。自定义渠道以第一个协议端点的
`GET /models` 为默认探测，并兼容常见的 `data[]`、`models[]` 和数组响应。
探测失败不影响渠道保存，用户仍可手工增加上游模型 ID。

发现只由用户操作触发；单次请求限制超时、响应体、分页和模型数量。规范化结果写入 D1，
响应未变化时只更新渠道级刷新状态，避免重复写完整库存。

### 7.3 导入规则

导入选中模型时：

1. 上游模型 ID 尚未占用时，建议将其直接作为统一模型 ID；
2. 同名统一模型已存在时，默认把新渠道实例加入该模型的 Fallback 顺序；
3. 用户要求独立或发生标识冲突时，使用
   `{provider-short}-{channel-token}-{provider-model-id}`；
4. 生成结果在提交前可编辑，空白字符规范成 `-`，最终必须通过全局标识唯一性校验；
5. 渠道直达 Alias 由渠道和上游模型稳定派生，重复导入必须幂等。

模型从供应商列表消失时只标记为不可见并提示管理员，既有模型卡片和路由保持不变。

### 7.4 手工创建

模型创建页使用允许自由输入的建议控件。建议来源按优先级为：所选渠道的可用库存、30 个
常见模型模板、用户输入。常见模板只用于填写便利，不代表当前 Key 一定具有访问权限。

### 7.5 渠道卡片与创建结果

渠道创建接口以服务端预置元数据为准生成协议端点。控制台先调用无持久化的预检接口，使用
用户当前填写的 Key 与连接信息请求模型列表，并在创建前展示协议、结果和完整可滚动模型列表。
预检不创建草稿渠道、不写 D1；Key、地址或协议变化后前端立即作废结果并要求重新检测。
支持的余额 adapter 仍在保存成功后调用一次。渠道卡片使用固定信息层级，仅展示模型总数与
最多 3 个预览；完整库存放在“编辑”详情中。

渠道列表摘要必须批量读取模型数量和预览，不允许为每个渠道分别查询 D1。套餐余量沿用
Provider adapter 扩展点；尚未实现的供应商显示“暂未接入”，不得将静态套餐配置当作余额。

预检完成后，模型清单默认全选，并支持全选、取消全选和逐项选择。保存时复用完整预检结果写入
渠道库存，不再重复请求 Provider；保存后导入只以已勾选模型为输入，未勾选模型仍保留在渠道
库存中供后续导入。导入沿用统一模型 ID 冲突和渠道直达 Alias 规则，单批最多 100 个，超出时
顺序分批，任一批失败时保留渠道和已完成结果。预检失败时只允许明确的降级保存并进入手工维护，
没有勾选模型时不得执行自动导入。

删除渠道前必须查询影响摘要。确认后移除该渠道的实例和 Alias；仍有其他实例的模型保持不变，
没有剩余实例的模型卡片软删除并释放标识。usage 仍通过名称快照保留历史展示。

## 8. 设计变更规则

新增协议或 Provider 专属能力时必须同时确认：

1. 官方端点和鉴权方式；
2. 原生能力与转换能力的区别；
3. 流式事件和 usage 语义；
4. 不支持字段的明确失败方式；
5. Provider 调用是否产生费用；
6. 是否引入新的 Cloudflare 组件、读写或共享状态；
7. 单元测试和真实集成测试覆盖。

已发布变化记录在 [CHANGELOG](../CHANGELOG.md)，未来方向只保留在
[README Roadmap](../README.md#7-roadmap)。
