# 多协议网关设计

> 状态：第一阶段已实现
>
> 对外协议：OpenAI Chat Completions、OpenAI Responses、Anthropic Messages

## 1. 产品约束

1. 一个渠道代表一个供应商账号和一份 API Key，可以配置多个原生协议端点。
2. 一个模型请求先选择与客户端协议相同的原生端点，再考虑允许的转换端点。
3. 同一优先级组内继续遵循模型实例的 `sort_order`，完整公开别名仍只访问指定渠道。
4. 第一阶段只允许 `openai_chat ↔ anthropic_messages`，不转换 Responses。
5. 找不到原生端点或已实现的转换路径时，返回 `protocol_unavailable`，不猜测端点。
6. 转换遇到无法安全表达的字段，返回 `unsupported_protocol_feature`，禁止静默删除。

## 2. 对外接口

| 客户端协议 | 路径 | 客户端鉴权 | 当前上游选择 |
|---|---|---|---|
| OpenAI Chat Completions | `POST /v1/chat/completions` | `Authorization: Bearer gw_...` | 原生 Chat；否则转换到 Messages |
| OpenAI Responses | `POST /v1/responses` | `Authorization: Bearer gw_...` | 仅原生 Responses |
| Anthropic Messages | `POST /v1/messages` | `x-api-key: gw_...` 或 Bearer | 原生 Messages；否则转换到 Chat |

无论内部选择哪个上游协议，客户端收到的响应和 SSE 事件都保持客户端请求的协议。

## 3. 渠道协议配置

渠道表继续保存供应商身份、加密 API Key 和兼容用的默认 Base URL。新增
`channel_protocols` 子表：

```sql
channel_id   TEXT
protocol     openai_chat | openai_responses | anthropic_messages
base_url     TEXT
auth_scheme  bearer | x_api_key
api_version  TEXT NULL
PRIMARY KEY (channel_id, protocol)
```

API Key 只加密保存一次。不同协议可以配置不同 Base URL、鉴权方式和 Anthropic
版本 Header，不需要重复创建渠道。升级迁移会为所有旧渠道自动创建
`openai_chat` 配置，保持原有请求行为。

## 4. 预制供应商

预制配置同时包含渠道信息和协议数组。管理员选择预制供应商后只输入一次 API Key：

- OpenAI：自动创建 Chat 和 Responses；
- Anthropic：自动创建 Messages；
- DeepSeek、Z.AI：自动创建已确认的 Chat 端点；
- 华为云（中国）、阿里云国际：用同一 Key 自动创建 Chat 和 Messages；
- 火山国际（BytePlus ModelArk）：用同一 Key 自动创建 Chat 和 Responses；
- Google Gemini、Mistral AI：自动创建已确认的 Chat 端点；
- Groq、xAI：用同一 Key 自动创建 Chat 和 Responses；
- MiniMax 国际：用同一 Key 自动创建 Chat 和 Messages；
- 其他 OpenAI-compatible 供应商：创建已验证的 Chat 端点；
- 自定义渠道：管理员可以勾选一个或多个协议，同一 Key 供这些协议共用。

预制配置只声明已知端点，不通过在线探测猜测能力，因此不会增加 Provider 调用或
Cloudflare 免费档成本。

| 预制供应商 | 自动配置的原生协议 | 默认区域/端点说明 |
| --- | --- | --- |
| DeepSeek | Chat | 官方通用端点 |
| Z.AI | Chat | 国际站通用 API；不混入 Coding Plan 专属端点 |
| 华为云（中国） | Chat、Messages | 西南-贵阳一 MaaS 公共端点 |
| 阿里云国际 | Chat、Messages | 新加坡共享端点；需要同区域 API Key |
| 火山国际（BytePlus） | Chat、Responses | ModelArk 新加坡端点；不混入 Coding Plan 专属端点 |
| Google Gemini | Chat | Google AI Studio OpenAI 兼容端点 |
| Groq | Chat、Responses | GroqCloud 官方通用端点 |
| MiniMax 国际 | Chat、Messages | 国际站通用端点；Messages 使用 `x-api-key` |
| xAI | Chat、Responses | Grok 官方通用端点 |
| Mistral AI | Chat | Mistral 官方通用端点 |

## 5. 路由算法

```text
解析统一模型/完整别名
  → 读取候选渠道及 channel_protocols（同一次 D1 路由查询）
  → native = 支持客户端请求协议的候选
  → translated = 缺少客户端协议、但存在 Chat/Messages 转换路径的候选
  → candidates = native（保持 sort_order）+ translated（保持 sort_order）
  → 被动熔断过滤
  → 响应提交前 Fallback
```

因此，一个排序靠后的原生 Messages 渠道会优先于排序靠前、但必须从 Chat 转换的
渠道。Responses 没有转换路径。只有 Chat/Messages 渠道的模型收到 Responses 请求时，
立即返回 422 `protocol_unavailable`。

## 6. Chat / Messages 第一阶段转换范围

已支持：

- `system` 与 system/developer message；
- user/assistant 文本；
- function tools 定义和 `tool_choice` 的公共语义；
- assistant tool call / Anthropic `tool_use`；
- tool response / Anthropic `tool_result`；
- `max_tokens`、`temperature`、`top_p`、stop sequences；
- 非流式响应、结束原因和 usage；
- SSE 文本增量、工具 JSON 增量、结束事件和最终 usage。

明确拒绝：

- Chat `response_format`、`logprobs`、`n` 等 Messages 无等价语义的字段；
- Anthropic `thinking`、`top_k`、文档块等 Chat 无等价语义的字段；
- 同一个 Anthropic user content 数组中混排普通内容和 `tool_result`；
- 任意 Responses 与 Chat/Messages 转换。

当前流式限制：Chat 上游只在流末尾返回 prompt token，因此转换成 Anthropic SSE 时，
`message_start.usage.input_tokens` 暂为 `0`；网关自己的统计仍读取流末真实 usage。后续只有在
引入可靠 tokenizer 或上游预计算接口后才修正客户端起始事件，不能用字符数冒充 token。

## 7. 免费档影响

- 路由查询通过 JSON 子查询一并读取渠道协议，不增加每请求 D1 round trip；
- 协议能力继续使用现有 isolate TTL/LRU 路由缓存；
- 非流式转换只进行一次 JSON parse/serialize；
- SSE 转换按事件增量处理，不缓存完整模型输出；
- 不新增 KV、Queues、Durable Objects、R2 或主动健康探测。

## 8. 下一阶段

1. 增加 Chat/Messages 图片内容公共子集与更完整错误格式转换；
2. 用真实 OpenAI、Anthropic SDK 做双向非流式、SSE 和工具调用集成测试；
3. 根据实际需求再评估 Responses ↔ Chat，默认仍保持严格不转换；
4. 协议转换能力从“代码已实现”升级为可查询的细粒度 feature matrix。
