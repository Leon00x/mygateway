# MyGateway 路线图

路线图遵循三个约束：优先复用现有数据面；默认适配 Cloudflare Free；不以牺牲
密钥安全、流式正确性或统计语义换取功能数量。

## 下一项提案：OpenAI Responses API + 渠道能力标记

状态：待确认，建议作为下一开发项。

### 为什么现在做

- 现有 Chat Completions 的鉴权、路由、缓存、Fallback、被动熔断、密钥解密和
  用量汇总已经形成可复用底座。
- Responses API 可以扩大新版 OpenAI SDK 和应用框架的兼容面。
- 采用 OpenAI-compatible 原样转发，不需要新增 Cloudflare Binding 或后台服务。
- 先建立“实例支持哪些协议”的能力标记，可以避免把 Responses 请求错误地发给
  只支持 Chat Completions 的渠道。

### 本阶段范围

1. 新增 `POST /v1/responses`，保留 OpenAI Responses 请求与响应结构，只替换
   上游模型和鉴权信息。
2. 模型实例增加 `supports_responses` 能力标记，管理后台可配置并清楚展示。
3. 统一模型只选择支持 Responses 的候选；完整公开别名仍保持精确单渠道语义。
4. 复用现有 Gateway Key、D1 batch、isolate 缓存、最大尝试数和被动熔断。
5. 非流式解析 `usage.input_tokens` / `usage.output_tokens`。
6. 流式原样转发 Responses SSE，并从 `response.completed` 的
   `response.usage` 提取用量。
7. 响应提交前继续支持连接错误、超时、`408`、`429`、`5xx` Fallback；流开始
   后不切换渠道。
8. 更新 OpenAPI、README、架构文档和 Dashboard 快速开始示例。

### 明确不包含

- Chat Completions 与 Responses 之间自动转换。
- Claude Messages、Gemini 原生协议或跨 Provider 协议翻译。
- Hosted tools、文件上传、向量库、Realtime 和后台异步任务托管。
- 自动重写供应商不支持的 Responses 字段。
- 精确账单、跨 isolate 精确限流或付费状态组件。

### 数据库与免费档影响

- 预计增加一条 D1 migration，为模型实例新增布尔能力字段；不修改已有密钥。
- 每次请求仍只使用现有鉴权/路由读取和最终 usage UPSERT。
- 不新增 KV、Queues、Durable Objects、R2 或主动 Provider 探测。
- 不支持 Responses 的现有实例默认关闭该能力，升级后不会改变当前 Chat 路由。

### 验收条件

- OpenAI SDK 可以通过 Gateway Key 完成 Responses 非流式调用。
- 流式调用原样收到标准事件顺序和最终完成事件。
- 统一模型不会选择未启用 Responses 能力的实例。
- 第一候选在响应开始前返回可回退错误时，第二候选成功。
- 指定完整别名失败时不会改走其他渠道。
- 非流式和流式 usage 都能精确写入分钟汇总；缺失时标记未知。
- Chat Completions 的现有 41 个单元测试和 10 个 E2E 不回归。
- 新增 Responses parser、流式分片、Fallback 和能力过滤测试。
- 代表性请求继续满足 Cloudflare Free 的 CPU、子请求和 D1 设计约束。

### 建议实现顺序

1. D1 migration、数据模型和管理后台能力开关。
2. 协议无关的上游候选选择与请求上下文抽取，减少 Chat/Responses 重复代码。
3. Responses 非流式代理和 usage parser。
4. Responses SSE 透传、取消和最终 usage parser。
5. Fallback、熔断、结构化日志和计时接入。
6. 单元测试、E2E、OpenAI SDK smoke test、文档和部署。

## 后续候选

### Provider Adapter 与能力矩阵

- Provider 专属鉴权、错误码和 usage 差异适配。
- 在 System/Models 页面展示协议、流式 usage、工具调用等能力。
- 仅对已验证 Provider 开启专属逻辑，默认仍走 OpenAI-compatible adapter。

### 手工成本估算与预算展示

- 基于管理员维护的输入/输出价格和 Provider usage 估算成本。
- 明确标记“估算”，不冒充供应商账单。
- 先做展示和告警阈值，不做跨 isolate 强制预算拦截。

### 更晚阶段

- Claude Messages、Gemini 原生协议。
- 多用户/RBAC、API Key 权限。
- 需要共享状态后再评估 Durable Objects 限流与预算控制。
- 主动健康探测、余额 API 和通知必须显式评估 Provider 调用费用。
