# MyGateway 路线图

路线图遵循三个约束：优先复用现有数据面；默认适配 Cloudflare Free；不以牺牲
密钥安全、流式正确性或统计语义换取功能数量。

## 当前开发项：多协议原生路由 + Chat / Messages 转换

状态：第一阶段已实现，待真实供应商集成验证。

详细设计与已实现边界见 [多协议网关设计](PROTOCOLS.md)。

### 已实现

- 对外提供 `/v1/chat/completions`、`/v1/responses`、`/v1/messages`。
- 一个供应商渠道用一份 Key 配置多个协议端点。
- 同协议原生候选优先；Responses 无原生候选时明确报错。
- Chat 与 Messages 的文本、function tools、usage 和 SSE 双向转换。
- 预制供应商一次输入 Key 自动创建已知协议配置。
- 协议配置随现有 D1 路由查询和 isolate 缓存返回，不增加每请求查询。
- DeepSeek 官方余额按需查询，并在渠道页和首页逐渠道展示；5 分钟 isolate 缓存不新增存储成本。

### 下一步验收与完善

1. OpenAI SDK 对 Chat 和 Responses 的真实请求与流式 smoke test。
2. Anthropic SDK 对原生 Messages、Messages → Chat 转换的真实 smoke test。
3. Chat → Messages 的工具调用和任意网络分片 SSE 集成测试。
4. 管理后台增加协议端点编辑，而不只是创建时选择。
5. 为 Anthropic 客户端补齐原生错误 envelope 转换。
6. 增加 Chat/Messages 图片内容的可验证公共子集。

### 继续不包含

- Chat Completions 与 Responses 之间自动转换。
- Gemini 原生协议。
- Hosted tools、文件上传、向量库、Realtime 和后台异步任务托管。
- 自动重写或静默删除供应商不支持的字段。
- 精确账单、跨 isolate 精确限流或付费状态组件。

### 数据库与免费档影响

- 已增加 `channel_protocols` migration，不修改已有密钥；旧渠道自动回填 Chat。
- 每次请求仍只使用现有鉴权/路由读取和最终 usage UPSERT。
- 不新增 KV、Queues、Durable Objects、R2 或主动 Provider 探测。
- SSE 转换按事件增量进行，不缓存完整输出。

## 后续候选

### Provider Adapter 与能力矩阵

- Provider 专属鉴权、错误码和 usage 差异适配。
- 在 System/Models 页面展示协议、流式 usage、工具调用等能力。
- 将转换能力细化到文本、图片、工具、thinking 等 feature matrix。
- 仅对已验证 Provider 开启专属逻辑，未知能力默认关闭。

### 手工成本估算与预算展示

- 基于管理员维护的输入/输出价格和 Provider usage 估算成本。
- 明确标记“估算”，不冒充供应商账单。
- 先做展示和告警阈值，不做跨 isolate 强制预算拦截。

### 更晚阶段

- 根据实际需求评估 Responses ↔ Chat 转换。
- 多用户/RBAC、API Key 权限。
- 需要共享状态后再评估 Durable Objects 限流与预算控制。
- 扩展其他 Provider 余额 API、主动健康探测和通知前，必须逐家确认官方接口、调用成本和语义。
