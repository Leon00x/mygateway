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

控制台对预置与自定义渠道复用同一个三行协议编辑器：每行固定协议类型和 Provider 请求 path，
允许独立启用并修改 Base URL。危险确认与结果提示统一使用应用内 Dialog，不调用浏览器原生
`alert` / `confirm`；新建渠道和新建自定义模型均使用模态表单，避免卡片网格发生布局跳动。

### 1.1 规范网站访问地址

System 页将“管理员账号”和“网站访问域名”放在同一层级的相邻卡片中。浏览器 Origin 只作为
初始建议值，必须由管理员点击保存后才写入 `system_settings.public_url`。服务端将输入规范为
纯 HTTP(S) Origin；控制台的首页 API 地址、curl 示例和 Management Skill 提示词共享该值，
未配置或读取失败时各自回退到当前浏览器 Origin。此设置描述已有部署的公开入口，不创建 DNS、
Worker Route 或 Custom Domain。

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

Management API 通过 `GET /management/v1/provider-presets` 返回这份清单。Agent 必须优先选择预置并在
preflight/create 中传 `preset_id`，协议端点仍可编辑。为兼容旧 Agent 和已有数据，服务端创建渠道及
Dashboard 展示可按“协议类型 + 官方 API Host”做唯一匹配；只匹配 Host 而不锁死 Path，以兼容区域
和兼容层路径差异。匹配不到或出现歧义时不得猜测，继续按自定义渠道展示。

预置的 `name` 是写入新渠道的英文规范名，`name_zh` 是可选中文展示名。Dashboard 只在渠道名
仍等于英文或中文预置默认值时按当前语言本地化；已被管理员修改的名称不翻译。这样无需 migration
即可兼容历史 D1 中保存的中文默认名。

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

## 6. Provider 余额与套餐

### 6.1 当前支持边界

余额只对主机名严格等于 `api.deepseek.com` 的官方渠道开放。第三方托管的 DeepSeek 模型
不会使用其 Key 请求 DeepSeek 官方接口。

Worker 调用：

```http
GET https://api.deepseek.com/user/balance
Authorization: Bearer <provider-key>
```

官方响应中的 `CNY` / `USD` 金额以字符串验证和展示，避免 JavaScript 浮点数改变精度。
余额是 Provider 账户维度，不等于 Token 套餐，也不能跨渠道或币种求和。

重点供应商的推理 Key、MaaS Key、控制面凭据和套餐 Key 并不等价。当前只有 DeepSeek 官方
余额完成产品接入；MiniMax Token Plan 存在 Key 可调用的剩余额度端点，但返回的是滚动套餐
配额，不是货币余额。其余供应商多数需要 IAM、Access Key 或独立 Admin Key。完整可行性矩阵
和官方来源见[供应商与模型](PROVIDERS.md#3-余额与套餐查询可行性)。

后续 Adapter 必须区分 `monetary_balance`、`subscription_quota` 与 `billing_usage`，不能为了
共用现有卡片把它们都转换成金额。

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

已发布变化记录在 [CHANGELOG](CHANGELOG.md)，产品特性与未来方向见
[PRD](PRD.md)（含 Roadmap）。

## 9. Analytics（Usage / Logs）重构

### 9.1 目标与边界

Analytics 将现有首页用量摘要和独立请求日志整合为一个导航分组，但不改变首页作为系统概览的
职责。Usage 是低成本聚合指标，始终记录；Logs 是可选请求明细，可以完全关闭。Cloudflare
Workers 的抽样运行日志仍只用于运维，不作为控制台精确统计来源。

本期不实现实时追踪、Prompt 搜索、全量响应归档、跨请求 Trace、外部日志平台、精确账单或
强一致实时限流。费用继续标记为按管理员单价与 Provider Token 估算。

### 9.2 信息架构与 UI

```text
Analytics
├── Usage  /analytics/usage
└── Logs   /analytics/logs
```

两页复用带用途副标题的页面标题、Usage / Logs 胶囊分段切换和筛选控件样式，延续现有浅色 /
暗黑主题与紫色强调，不引入新的组件库。筛选框统一为 48px 高、14px 圆角和弱边框；用量页桌面
按“时间、模型、密钥、粒度”排列，日志页将时间放在首位并按空间换行，窄屏降为两列或单列。
旧 `/requests` 保留兼容跳转。

**Usage**

- 筛选：今日 / 7 天 / 30 天、统一模型、Gateway Key、按小时 / 天聚合；筛选变化后一次请求
  返回摘要、趋势和模型明细，避免前端并发请求多个统计接口。
- 首屏指标卡展示请求量、平均请求用时、平均首 Token 延迟、成功率和平均缓存命中率。
  平均请求用时是完整请求处理时长，不表示 TTFB；平均缓存命中率是缓存输入 Token 占总输入 Token 的汇总比例。
  首 Token 延迟仅统计流式请求；无流式样本时显示 `—`，
  不显示假 0。
- 下方模型表展示模型、平均 TPM/RPM、请求、成功率、平均首 Token 延迟、平均请求用时、Token 与费用；
  空、加载、错误状态使用与最终布局同尺寸的骨架和面板。

**Logs**

- 日志策略集中在 System 页面配置：请求日志总开关、异常日志、正常日志、记录上下文和保留期；
  清空日志也作为独立危险操作放在该模块底部。Logs 页面只负责查询、导出与详情，避免高风险
  写入策略和日常筛选混在一起。上下文和清空操作都需要二次确认并展示影响范围。
- 筛选：时间范围、模型、Gateway Key、渠道、状态、精确 Request ID；默认手动刷新，不在后台
  每 15 秒轮询。可选自动刷新仅在页面可见时工作，并默认关闭。
- 表格：Request ID、时间、模型、渠道、Key、Token、TTFT、延迟、状态和详情操作；移动端折叠为
  摘要行与详情抽屉。分页采用 `(timestamp, id)` 游标，不用深 Offset，也不默认执行全表 COUNT。
- 详情抽屉展示协议、流式状态、尝试次数、Fallback、费用、错误详情和可用的上下文预览；无上下文
  时明确显示“未启用上下文记录”，不能把空值伪装成丢失数据。

### 9.3 数据与写入路径

新增五分钟 Analytics 聚合桶，维度为 Key、统一模型和最终渠道，计数包含请求结果、Token、费用、
延迟总和/样本数、流式 TTFT 总和/样本数、尝试与 Fallback。旧分钟数据可以只回填无 Key、无
TTFT 的历史桶；界面必须据样本数计算覆盖率。

```text
请求完成 / 拒绝
  → 构造 Analytics 聚合 UPSERT
  → 构造 Key 日用量 UPSERT（预算权威数据）
  → 日志总开关与级别允许时构造 request_logs INSERT
  → 一次 D1 batch，由同一个 waitUntil 提交
```

- 数据面不等待 Analytics 写入；失败只产生脱敏运行事件，不修改已经返回的模型响应。
- 一次请求最多写一个聚合桶、一个 Key 日用量和一个可选日志行。`batch()` 减少网络往返，不能
  把三行写入误算成一行 D1 配额。
- TTFT 定义为流式响应从网关收到请求到首次向客户端输出有效内容的时间；非流式请求不进入
  TTFT 平均值。总延迟为请求结束或流终止时间。
- 拒绝、预算超限和模型无权限也进入聚合请求/失败计数；是否保存其明细由异常日志开关决定。

建议设置：

| 设置 | 默认 | 行为 |
|---|---|---|
| `request_logs_enabled` | 开 | 明细日志总开关；关闭后不写 `request_logs` |
| `log_errors` | 开 | 错误、中断、限流、预算和权限事件 |
| `log_success` | 开（兼容现有部署） | 成功请求明细；用户可关闭以显著减少写入 |
| `log_context` | 关 | 请求/响应内容预览，显式确认后才启用 |
| `request_log_retention_days` | 7 天 | 可选 1 / 3 / 7 天，Cron 清理 |
| `context_retention_hours` | 24 小时 | 不得超过请求日志保留期 |

### 9.4 上下文与安全

- 默认不保存 Prompt、Response、Authorization、Provider Key、Gateway Key、Cookie 或原始 Header。
- 开启上下文后，请求和响应分别只收集前 4 KiB UTF-8 预览；流式响应增量收集到上限即停止，
  不能为了日志缓存完整响应或延迟客户端输出。
- 上下文使用 `MASTER_KEY` 派生用途隔离密钥并以 AES-GCM 加密，日志 ID 作为 AAD；列表接口不
  返回密文或明文，只有单条详情接口按管理员 Session 解密。
- 开关关闭后不再采集新上下文；界面提供“清空请求日志”，已有内容由用户删除或按短保留期清理。
- 错误详情保持截断和脱敏，Provider 原始错误体不能未经筛选写入 D1。

### 9.5 管理 API 与查询约束

| 接口 | 说明 |
|---|---|
| `GET /admin/api/analytics/usage` | 一次返回筛选后的摘要、趋势与模型表 |
| `GET /admin/api/analytics/logs` | 游标分页日志；最多 100 条/页 |
| `GET /admin/api/analytics/logs/:id` | 单条详情，按需解密上下文 |
| `GET/PUT /admin/api/analytics/settings` | 日志开关与保留策略 |
| `DELETE /admin/api/analytics/logs` | 显式确认后清空明细，不删除聚合 Usage |

查询必须走时间前缀索引，并为常用的 Key、模型、状态 + 时间组合建立索引。Usage 页面一次交互只
调用一个聚合接口；Logs 不在每页执行无条件总数统计。筛选参数、时间跨度和 page size 全部设上限。

### 9.6 性能与验收

- 日志总开关关闭时不新增明细写入、上下文序列化或加密；策略使用 isolate TTL 缓存，管理修改
  清除当前 isolate 缓存。
- 与当前顺序三次 D1 调用相比，完成路径改为一次 `batch()`；需分别验证日志关闭、只异常、全部
  和上下文开启四种写入数量。
- 移除无清理的 15 秒定时器；任何可选轮询在路由卸载和页面隐藏时停止。
- 单元测试覆盖聚合数学、TTFT 样本、策略矩阵、批量写入、游标稳定性、上下文上限/加密/清理；
  E2E 覆盖 Usage/Logs 切换、筛选、空/错/加载状态、移动端详情和日志关闭后 Usage 仍增长。
- 生产基线记录 Worker CPU、D1 rows read/write、批量写入失败率和查询耗时；超过 Free Tier
  建议值时优先缩短保留期、关闭成功日志或降低聚合维度，不牺牲认证和流式正确性。

## 10. 价格库与费用计算

### 10.1 数据模型

- `model_prices`（迁移 0009）：以 `provider_model_id` 为主键的模型基准价，包含输入 / 输出
  价格（`*_price_micros_per_million`，整数 micro-USD 或 micro-CNY 每百万 Token）、可选缓存
  命中价和币种（`currency`：USD / CNY）。迁移同时为 `channel_models` 增加可选
  `cache_input_price_micros_per_million` 列，使渠道实例价与基准价结构对齐。
- 价格一律以整数 micros 存储（`$3 / M` → `3_000_000`），避免浮点累计漂移；
  `cost_micros` 汇总同样为整数。

### 10.2 价格解析优先级

计费价格按以下顺序解析（`model-discovery.ts` `resolvePrice`）：

1. **渠道实例价**（`channel_models` 的 input / output / cache / currency）——用户覆盖优先；
2. **价格库基准价**（`model_prices`）——导入预填与无覆盖时的兜底；
3. **未定价**——按 0 计费，不阻断请求。

渠道导入时，控制台先查询基准价并预填输入 / 输出 / 缓存与币种（`preflight` 响应携带
`baseline_price`），用户可修改后随模型导入写入渠道实例。

### 10.3 费用计算

`computeCostMicros`（`src/shared/cost.ts`）：

- 缓存命中 Token 按缓存价计费；未配置缓存价时按正常输入价（保守）；
- `cost = (非缓存输入 × 输入价 + 缓存 Token × 缓存价 + 输出 × 输出价) / 1_000_000`，四舍五入
  到整数 micros；
- 输入 / 输出价均为 0 且无缓存 Token 时直接返回 0，跳过计算。

请求完成时由 `usage-recorder` 调用，费用随 analytics 聚合、密钥日用量同一 `batch()` 写入。

### 10.4 已知币种边界

0.1.x 的 `analytics_minutes`、`request_logs` 和 `key_daily_usage` 只有 `cost_micros`，没有币种
列；计算也没有汇率换算。因此 USD / CNY 实例价格可以分别配置和展示，但聚合费用不能安全地
跨币种相加。修复前部署必须选择单一记账币种。后续实现应新增币种维度并分币种汇总，或将
产品明确收敛为单一币种；不得使用隐式实时汇率。

### 10.5 管理 API 与控制台

- `GET /admin/api/model-prices` 列表；`PUT` 全量 upsert；`DELETE /:id` 单条删除。
- System 页价格库卡片：行内编辑输入 / 输出 / 缓存 / 币种，批量保存；删除行同步调用 DELETE，
  失败时回滚并重新加载。

## 11. Agent Management API

### 11.1 身份与生命周期

- migration `0012_management_keys.sql` 新增 `management_keys` 与 `management_audit_logs`；已发布
  migration 不回写。
- Management Key 使用 `mgmt_` + 32 随机字节，服务端只保存 SHA-256 hash；`expires_at: null`
  表示永久，内部映射为 Unix 秒上限哨兵值；短期 isolate 缓存
  正命中最多 30 秒、负命中 5 秒，并受密钥到期时间约束。
- 权限为 `read` / `write`。非 GET/HEAD 请求统一要求 `write`；停用、删除、到期或 hash 不匹配
  均按无效机器身份处理。
- System 页支持创建、停启和删除；明文配置提示词最多在当前浏览器保存 1 小时。

### 11.2 API 白名单

`/management/v1` 复用 Admin handler 的输入校验、重复检测与数据库逻辑，但路由采用独立显式
白名单，不复用管理员 Session。开放渠道、余额、模型、Gateway Key、Usage、日志元数据和系统
状态；不开放账号、日志策略、清空日志、价格库或 Management Key 的签发。

`GET /management/v1/overview` 是 Management Key 保护的 Agent 初始化快照。它批量读取渠道与协议、
统一模型及实例和 Gateway Key，并只合并当前 isolate 已有的余额缓存，不主动请求 Provider。响应不含
Base URL、Key 前缀、Provider Key、密文或日志上下文；模型实例只标记是否已定价和币种，不在初始化
摘要中展开单价。服务端按可调用链路返回状态：无渠道为 `needs_channel`；没有由活动模型、活动实例和
活动渠道组成的链路为 `needs_model`；没有未过期活动 Gateway Key 为 `needs_gateway_key`；否则为
`ready`。响应中的 `authorization.permission` 来自已完成鉴权的当前 Management Key；公开
capabilities 中的 `permissions` 仅表示 API 支持的权限类型。该状态用于引导而不是健康监控，不宣称
跨 isolate 强一致。

渠道输出继续走 `toPublicChannel`；日志详情额外强制删除上下文密文列并将上下文设为 `null`。
审计记录不包含 query 和 body，防止 Provider Key 或其他一次性凭据进入审计表。

`GET /management/v1/capabilities`、`/openapi.json` 与 `/api-docs` 是公开发现入口，不要求
Management Key；文档公开不改变资源操作的鉴权。`/v1/api-docs` 使用 Scalar 的多规范入口，允许在
Gateway API 与 Management API 间切换。Management OpenAPI 描述每个操作的 `read` / `write`
要求、路径和查询参数、请求体、主要响应结构，以及 Provider Key 只写和日志上下文不可见约束。

### 11.3 Skill

`skills/mygateway-admin/` 是仓库内官方 Skill。首次连接时优先将地址和 Management Key 写入 Agent
平台的持久化凭据存储；若平台不提供该能力但有持久化本地文件系统，则写入仓库外、目录权限
`0700`、文件权限 `0600` 的配置文件。后续会话先加载为环境变量，再查询 capabilities 并用 `curl`
或 Agent 自带的等价 HTTP 工具直接调用 API。密钥不得进入 Skill 源码、代码仓、聊天记忆或输出。
Skill 不依赖代码仓或 Node helper；在删除、凭据轮换或批量导入前要求确认，且不得通过 D1、Cloudflare
Secret 或 Dashboard DOM 绕过 Management API。

首次安装或连接变化后，Skill 只调用一次 Overview 完成体检，先向用户总结供应商、协议、模型、
实例和客户端 Key，再根据 `setup_state` 引导添加渠道、配置模型或创建 Gateway Key。各资源章节先解释
产品作用、用户需要准备的输入和字段归属，再列常用 API。渠道预检负责连接和模型发现；价格属于
统一模型的渠道实例，使用每百万 Token 的整数 micros 和明确币种，未知价格保持未设置且不得估算。

Skill 使用固定资源心智模型：Channel 保存上游连接；Provider model inventory 是自动发现或手工
登记的渠道暂存清单，不是可调用模型；Unified model 是客户端模型 ID；Channel instance 负责绑定、定价与回退顺序；
Gateway Key 负责数据面访问。`preflight` 只探测不保存，`models/refresh` 使用已保存连接发现并仅更新渠道
暂存清单，`models` 集合维护该清单，只有 `models/import` 才创建统一模型/实例并使其进入路由候选。
清单的 `available` 不代表数据面兼容；
当前没有 Images、Video、Embeddings 等端点，Skill 不得从模型名称推测能力或建议将其作为可调用模型。

常规查询遵循最小 API 原则：渠道、库存、统一模型、余额、用量和日志各自使用对应接口，除首次总览
外不先调用 Overview，也不为读取库存自动 refresh。OpenAPI 仅在需要精确 schema 时读取并在当前
任务内复用。`active` 是配置启用状态而非健康结论；面向用户
默认隐藏内部 ID、Base URL、auth scheme 和原始 JSON，仅在后续操作需要时使用这些机器字段。

`SKILL.md` 自包含认证规则、API 路径与 `curl` 示例，不引用本地脚本或额外参考文件。Dashboard
构建会将其发布到网站根路径 `/skill.md`。System 页始终展示同源 Skill
配置提示词：默认使用 `mgmt_YOUR_MANAGEMENT_KEY` 占位；创建后最多 1 小时替换为真实明文，
到期、删除或本地缓存失效后自动恢复占位模板。提示词只要求 Agent 使用自身平台的标准方式安装
Skill；首次连接、连接信息变化或遇到版本类错误时读取 `/skill.json`、发现新版本后重新安装
`/skill.md` 的规则封装在 Skill 内，常规会话不重复检查版本，
不重复写入用户复制的提示词。Manifest 用 `entry: SKILL.md` 表示本地标准文件名，`download_url` 指向
同源托管的 `/skill.md`；部署站点是唯一更新权威源，Agent 不搜索本地代码仓或缓存判断最新版。
构建生成的 `/skills/index.json` 同步发布同一个 manifest 版本，避免手工维护漂移。

## 12. 控制台 i18n

- 中英双语字典以模块级 Solid signal `locale` 提供，`t(key)` 返回 `entry[locale()] ?? entry.zh ?? key`。
- 默认中文；顶部语言开关切换并持久化到 `localStorage`（`mygateway.locale`）；`<html lang>` 随
  语言同步。
- 预置供应商名称通过 `localizedPresetName` / `localizedChannelName` 切换语言；自定义名称不翻译。
- 新页面文案必须同时提供 zh / en 条目；缺失时回退中文，不阻断渲染。

## 13. 控制台视觉与交互规范

控制台追求克制、可信、信息层级清楚的企业级工具感。QwenCloud 可作为布局密度、圆角与留白的
审美参考，但不是逐页复刻目标；项目自身的设计 Token、组件行为和可访问性规则才是实现依据。

- **层级**：页面只保留一个主标题；副标题仅用于解释整页目的，不在卡片内重复标题含义。操作区、
  筛选区和内容区通过间距与弱分隔建立层次，不用堆叠说明文字制造层级。
- **密度**：桌面端优先紧凑但可扫描的布局，表单控件和同组卡片保持一致高度、内边距与基线；
  移动端允许换行和堆叠，不以缩小字号强塞桌面布局。
- **视觉语言**：以中性色表面、弱边框、有限阴影和紫色强调为主。圆角、阴影、状态色必须复用
  现有设计 Token，不为单一页面增加新的视觉体系或大面积装饰背景。
- **状态**：运行、停用、成功和异常使用圆点、图标与文字共同表达；普通状态不使用高饱和整块底色。
  空状态应保留真实卡片的结构与操作语义，避免纯白占位或突兀的大按钮。
- **操作**：每个页面只突出一个主要操作。常用操作直接可见，低频和危险操作进入更多菜单；菜单、
  日历和弹窗必须位于独立浮层并正确处理堆叠、视口边界和键盘关闭。
- **反馈**：加载、空、错误和成功状态使用项目内组件；不得调用浏览器原生 `alert` / `confirm`。
  错误文案先说明发生了什么，再给出可执行的下一步，不显示未经整理的上游响应。
- **图表**：必须显示量纲、时间范围和无数据状态；点、线、柱宽随可视范围保持稳定，颜色同时使用
  图例或标签区分。Hover 可以显示精确值，但关键含义不能只依赖 Hover。
- **主题与无障碍**：亮暗主题保持相同信息层级和可读对比；交互元素具备可见焦点、可访问名称和
  足够点击区域，并尊重 `prefers-reduced-motion`。

新增页面应优先复用已有 PageHeader、分段导航、筛选控件、卡片、表格、Dialog 和状态表达。若需要
引入新的 UI 模式，应先在本节记录可复用规则，再落到具体页面，避免按截图追加一次性 CSS。
