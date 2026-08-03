# PRD：Cloudflare AI Aggregation Gateway

> 文档版本：MVP v0.1
>
> 文档状态：已确认范围，待实现
>
> MVP 原则：先完成最小可部署、可调用、可回退、可观测的完整闭环。

## 1. 产品定义

Cloudflare AI Aggregation Gateway 是一个部署在用户自己 Cloudflare 账号中的轻量 AI 网关。

用户可以配置多个 OpenAI Compatible 渠道，用一个统一的模型 ID 和 Gateway API Key 调用模型。网关按照管理员保存的固定顺序选择渠道，并在上游尚未开始向客户端返回响应时执行 Fallback。

MVP 不追求覆盖所有 AI Provider，也不做协议转换、动态负载均衡或精确费用结算。第一版只验证以下核心价值：

- 无需自建服务器即可部署 AI 网关；
- 一个调用入口管理多个兼容渠道；
- 首选渠道故障时可以切换备用渠道；
- Provider API Key 由用户自己保存和管理；
- 可以查看基础调用量和 Token 用量。

## 2. 目标用户与使用场景

### 2.1 目标用户

- 个人开发者；
- 需要统一管理多个 AI 渠道的小型团队；
- 希望把网关部署到自己 Cloudflare 账号、避免维护服务器的用户；
- 日调用量不超过约 10,000 次的轻量使用场景。

MVP 是单管理员产品。Gateway API Key 只代表调用凭据，不代表独立用户账号或租户。

### 2.2 核心使用场景

1. 用户通过 Deploy to Cloudflare 部署项目；
2. 用户登录管理后台；
3. 用户添加两个 OpenAI Compatible 渠道；
4. 用户创建一个统一模型，并为它绑定两个渠道模型实例；
5. 用户拖拽设置固定优先级；
6. 用户创建 Gateway API Key；
7. 用户使用 OpenAI SDK 调用 `/v1/chat/completions`；
8. 第一渠道可用时直接返回，第一渠道在响应开始前失败时尝试第二渠道；
9. 用户在看板查看请求量、实际渠道和可获得的 Token 用量。

## 3. MVP 目标与成功标准

### 3.1 MVP 目标

MVP 上线必须完成以下闭环：

```text
一键部署
  → 管理员登录
  → 添加渠道
  → 创建统一模型和渠道别名
  → 创建 Gateway API Key
  → 发起流式/非流式调用
  → 响应前故障自动 Fallback
  → 查看基础使用统计
```

### 3.2 成功标准

| 指标 | MVP 验收标准 |
|---|---|
| 部署 | 新 Cloudflare 账号无需本地执行命令即可完成 Worker、静态资源和 D1 部署 |
| 首次调用 | 部署后可在 10 分钟内完成渠道配置并成功调用模型 |
| 路由正确性 | 统一模型始终按保存顺序选择第一个可用渠道 |
| 指定渠道 | 使用完整渠道别名时只调用目标渠道，不跨渠道 Fallback |
| Fallback | 首选渠道在响应开始前返回可回退错误时可以切换备用渠道 |
| 流式转发 | SSE 可以持续透传，客户端断开时上游请求被取消 |
| 安全 | Provider Key 和 Gateway Key 不出现在数据库明文、管理查询响应和日志中 |
| 统计 | 能统计请求数、成功/失败、Fallback 次数以及 Provider 返回的 Token 用量 |
| 免费方案 | 在目标轻量负载下不持续触发 Workers CPU 或 D1 每日额度错误 |

## 4. 产品原则

### 4.1 固定路由优先

MVP 的自动路由是管理员保存的固定优先级，不是随机、轮询或动态成本调度。同一配置下，同一统一模型默认选择同一个首选渠道。

### 4.2 只做协议内转发

MVP 只提供 OpenAI Chat Completions 协议，不把 OpenAI 请求转换成 Claude、Gemini 或其他原生协议。

### 4.3 Fallback 只发生在响应提交前

只有在尚未向客户端发送响应字节时，网关才能安全切换渠道。流式响应已经输出 SSE 后发生错误时，网关终止当前流并记录错误，不切换到另一个渠道继续生成。

### 4.4 用量是尽力统计，不是账单

网关只记录 Provider 响应中实际返回的 usage。Provider 未返回、流被中断或解析失败时，记录调用次数并标记 `usage_unknown`，不把未知用量错误记为 0，也不承诺与 Provider 账单完全一致。

### 4.5 手工套餐信息不参与自动路由

MVP 可以手工填写价格和 Token 套餐信息用于展示，但不自动查询、不自动扣减，也不用于动态改变路由顺序。

## 5. MVP 功能模块

### 5.1 部署与初始化

MVP 使用一个 Cloudflare Worker 承载：

- `/v1/*` 网关 API；
- `/admin/api/*` 管理 API；
- SolidJS 管理后台静态资源；
- D1 数据库绑定。

部署要求：

- 提供 Deploy to Cloudflare 按钮；
- 自动创建并绑定 D1；
- 自动执行数据库 migrations；
- 自动构建和部署管理后台；
- 部署时要求用户配置 `ADMIN_TOKEN` 和 `MASTER_KEY` 两个 Worker Secret；
- 部署完成后显示管理地址和 Gateway Base URL。

MVP 不单独部署 Cloudflare Pages，不依赖用户自行运行 GitHub Actions。

### 5.2 管理员认证

MVP 使用单管理员 Token 登录：

- `ADMIN_TOKEN` 保存为 Worker Secret；
- 管理员在登录页输入 Token；
- 验证成功后签发短期、HttpOnly 的管理 Session Cookie；
- Cookie 使用从 `ADMIN_TOKEN` 派生的 HMAC 密钥签名；
- Cookie 设置 `Secure`、`HttpOnly`、`SameSite=Strict`；
- 支持查询登录状态和退出登录；
- 管理 API 拒绝未认证请求；
- 管理接口不依赖 CORS 作为认证手段。

Cloudflare Access 作为后续可选增强，不是 MVP 部署的前置条件。

### 5.3 渠道管理

MVP 支持：

- OpenAI 官方；
- 其他 OpenAI Compatible 渠道。

渠道字段：

- 渠道名称；
- Provider 类型；
- HTTPS Base URL；
- Provider API Key；
- 启用/停用状态；
- 可选备注；
- 创建时间和更新时间。

管理功能：

- 创建、编辑、启用、停用渠道；
- 删除未被模型实例引用的渠道；
- 测试渠道连接；
- Provider API Key 更新后不再回显明文。

Provider API Key 使用 `MASTER_KEY` 通过 AES-GCM 加密后存入 D1。

### 5.4 模型管理

#### 统一模型卡片

每张模型卡片包含：

- 全局唯一的统一模型 ID，例如 `deepseek-chat`；
- 显示名称；
- 启用/停用状态；
- 一个或多个渠道模型实例。

#### 渠道模型实例

每个实例包含：

- 所属渠道；
- 上游真实模型 ID；
- 全局唯一的完整公开别名；
- 固定排序 `sort_order`；
- 启用/停用状态；
- 是否支持流式 usage；
- 可选手工输入价、输出价和币种；
- 可选手工 Token 套餐总量、剩余量和过期时间。

示例：

```text
统一模型 ID：deepseek-chat

渠道实例 1：
  上游模型 ID：deepseek-chat
  完整公开别名：ds-deepseek-chat
  排序：1

渠道实例 2：
  上游模型 ID：deepseek-v3
  完整公开别名：backup-deepseek-chat
  排序：2
```

调用规则：

- `model=deepseek-chat`：按 `sort_order` 依次选择可用实例；
- `model=ds-deepseek-chat`：精确指定对应渠道实例，不跨渠道 Fallback；
- 统一模型 ID 和完整公开别名之间不得冲突；
- MVP 不使用仅保存 `ali-` 这类前缀再猜测模型的设计。

管理后台支持添加、编辑、删除实例以及拖拽排序。

### 5.5 Gateway API Key 管理

MVP 支持：

- 创建多个 Gateway API Key；
- 为每个 Key 设置名称；
- 启用、停用、删除和重新生成；
- 明文只在创建或重新生成时显示一次；
- 所有 Key 默认可调用所有已启用模型。

Key 格式：

```text
gw_<32 字节以上高熵随机值>
```

D1 只保存 SHA-256 hash 和用于展示的短 prefix。

客户端鉴权：

```http
Authorization: Bearer gw_xxx
```

### 5.6 Chat Completions 网关

MVP 提供：

```http
POST /v1/chat/completions
GET  /v1/models
```

`/v1/chat/completions` 支持：

- `stream: false` 非流式响应；
- `stream: true` SSE 流式响应；
- 保留 OpenAI Chat Completions 请求体，只替换 `model`；
- 将 Gateway Key 替换为上游 Provider Key；
- 清理 Cookie、Cloudflare Header、客户端凭据等不应转发的 Header；
- 将客户端取消信号传递给上游；
- 返回 Gateway Request ID 便于排查。

`/v1/models` 根据已启用的统一模型和完整公开别名生成兼容模型列表。

### 5.7 固定路由与 Fallback

统一模型调用：

1. 查询已启用的模型卡片；
2. 查询已启用的渠道和模型实例；
3. 按 `sort_order` 升序排列；
4. 最多尝试 3 个渠道；
5. 第一个可接受的上游响应立即返回。

完整公开别名调用：

- 只尝试精确匹配的一个实例；
- 目标实例停用时返回模型不可用；
- 失败后不调用其他渠道。

MVP 可触发 Fallback 的情况：

- 上游连接失败；
- 等待响应 Header 超时；
- HTTP `408`、`429`、`500`、`502`、`503`、`504`；
- 明确的渠道额度不足错误。

不触发 Fallback 的情况：

- 请求 JSON 或参数无效；
- 统一模型或公开别名不存在；
- 上游返回普通 `400` 客户端错误；
- 客户端主动取消；
- 已经向客户端发送任何响应字节；
- 使用完整公开别名指定渠道。

MVP 不做同渠道原地自动重试，避免重复生成和重复计费。

### 5.8 SSE 流式处理

MVP 的流处理器：

- 按 SSE event 边界解析，不把网络 chunk 当作完整事件；
- 正确处理跨 chunk UTF-8 字符；
- 原样向客户端转发事件；
- 识别 `[DONE]`；
- 对明确支持的渠道注入 `stream_options.include_usage=true`；
- 从最终 Chat Completions usage chunk 提取用量；
- Provider 不支持 usage 或流被中断时记录 `usage_unknown`；
- 流开始后发生错误时终止流，不执行 Fallback。

### 5.9 基础用量统计

MVP 直接向 D1 的分钟级汇总表执行 UPSERT，不保存 Prompt、Response 或请求级原始记录。

统计字段：

- 客户端请求数；
- 成功数；
- 失败数；
- Fallback 请求数；
- 最终尝试次数；
- 输入 Token；
- 输出 Token；
- usage 未知请求数；
- 最终使用的模型和渠道。

统计写入通过 `ctx.waitUntil()` 异步执行。统计失败不得影响模型响应。

数据默认保留 30 天，通过每日 Cron 清理。分钟粒度不等于每天只写 1440 次；每个完成请求仍会产生至少一次统计 UPSERT，因此 MVP 以轻量负载为目标。

### 5.10 使用看板

MVP 看板包括：

- 今日、7 天、30 天范围；
- 总请求数、成功数、失败数；
- 输入和输出 Token；
- usage 未知请求数；
- 模型调用排行；
- 渠道调用排行；
- 请求量和 Token 趋势；
- 手工价格和 Token 套餐信息及其更新时间。

看板不是 Provider 账单，不展示未经确认的精确费用。

### 5.11 安全与可观测性

MVP 必须满足：

- Provider Key 使用 AES-GCM 加密；
- Gateway Key 只保存 hash；
- 管理 Token、Gateway Key、Provider Key 不写日志；
- Base URL 只允许 HTTPS，且不能包含用户名、密码、query 或 fragment；
- 管理 API 和网关 API 都做请求体大小限制和输入校验；
- 上游请求使用 Header 白名单/重建策略；
- 每个请求生成 Gateway Request ID；
- 日志记录模型、渠道、状态码、耗时、尝试次数和 Fallback，不记录 Prompt 与 Response 正文；
- 提供不暴露敏感信息的 `/health` 接口。

## 6. 管理后台页面

| 页面 | MVP 功能 |
|---|---|
| 登录 | 输入管理员 Token、建立 Session、退出登录 |
| Dashboard | 请求、Token、成功率、模型和渠道统计 |
| Channels | 渠道 CRUD、启停、更新 Key、测试连接 |
| Models | 模型卡片、渠道实例、完整别名、拖拽排序、手工价格和套餐 |
| API Keys | 创建、一次性展示、启停、删除、重新生成 |
| System | Gateway 地址、版本、数据库状态和运行配置状态 |

## 7. MVP 明确不包含

- OpenAI Responses API；
- Claude Messages API；
- Gemini 原生协议；
- Embeddings、Images、Audio、Realtime、Batch、Files；
- OpenAI、Claude、Gemini 之间的协议转换；
- OAuth 渠道接入；
- 自动查询 Token 套餐余量；
- 自动查询 Provider 金额余额；
- MaaS Lab 或其他第三方价格自动抓取；
- 套餐优先和成本优先自动排序；
- 自动扣减手工套餐；
- 同渠道自动重试；
- 流输出后的 Fallback；
- 会话亲和、负载均衡、健康评分和主动健康探测；
- API Key 细粒度模型权限、RPM/TPM 和预算；
- 多管理员、多用户、多租户和角色权限；
- Prompt/Response 存储或响应缓存；
- 精确费用结算、账单对账和通知。

## 8. 非功能要求

### 8.1 性能

- 网关响应体必须采用流式转发，不能缓存完整 SSE；
- 典型请求的 Workers CPU P95 目标小于 8ms；
- 上线前必须对长 SSE、JSON 解析、Fallback 和密钥解密做 CPU 实测；
- 达不到 Workers Free 10ms CPU 约束时，应优化实现或明确要求 Workers Paid，不能静默牺牲正确性。

### 8.2 容量

- 推荐目标不超过 10,000 次客户端请求/天；
- D1 用量按实际行读写核算；
- D1 统计写入失败不阻断网关调用；
- 管理后台查询应限制时间范围和调用频率。

### 8.3 隐私

- 不持久化 Prompt 和 Response；
- 不记录客户端或 Provider 的明文密钥；
- D1 只保存配置、加密密钥材料和调用聚合元数据；
- 用户可以清除用量数据和删除所有渠道配置。

### 8.4 兼容性

- MVP 以 OpenAI Chat Completions 的公共请求/响应结构为兼容目标；
- OpenAI Compatible 渠道的非标准差异由渠道配置和后续 Provider Adapter 迭代处理；
- 不承诺所有标称 OpenAI Compatible 服务都支持全部可选字段。

## 9. MVP 发布验收

- [ ] Deploy Button 可在新 Cloudflare 账号完成部署；
- [ ] D1 自动创建且 migrations 自动执行；
- [ ] 管理员可以登录和退出；
- [ ] 可以添加两个渠道并完成连接测试；
- [ ] Provider Key 在 D1 中不是明文；
- [ ] 可以创建模型卡片和两个渠道实例；
- [ ] 统一模型和完整公开别名路由正确；
- [ ] 可以创建、停用、重新生成 Gateway Key；
- [ ] OpenAI SDK 可调用流式和非流式 Chat Completions；
- [ ] 响应开始前的 429/5xx 可以切换备用渠道；
- [ ] 流输出后的错误不会错误地切换渠道；
- [ ] usage 缺失时显示未知而不是 0；
- [ ] 看板可以查询今日、7 天和 30 天数据；
- [ ] 客户端取消会终止上游请求；
- [ ] 日志中没有 Prompt、Response 或明文密钥；
- [ ] 代表性负载测试不持续触发 Workers 1102 或 D1 配额错误。

## 10. 后续版本方向

### v0.2：协议和 Provider 扩展

- OpenAI Responses；
- Claude Messages；
- Gemini 原生接口；
- Provider 专属鉴权、错误分类和 SSE usage parser；
- 渠道能力矩阵。

### v0.3：路由和额度增强

- 经过验证的 Provider 余额或用量 API；
- 版本化价格数据；
- 成本评分和套餐策略；
- 熔断、健康探测和通知；
- 会话亲和和负载均衡。

### v1.0：团队和生产能力

- 多用户和 RBAC；
- API Key 权限、速率和预算；
- 审计、告警和导出；
- 更高容量的统计后端；
- 正式的 SLO 和恢复流程。

## 11. 技术架构

MVP 的具体模块、数据表、API、转发流程、安全边界和部署设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 12. 参考项目

| 项目 | 参考范围 |
|---|---|
| OmniRoute | 模型映射、网关交互和渠道管理思路 |
| cc-switch | 固定渠道切换和配置交互思路 |

参考项目只用于设计参考。MVP 是否复用其代码，需要在实现前单独完成许可证、代码质量和 Cloudflare 运行时兼容性评估。

## 验证（E2E 测试）

MVP 使用 Playwright 驱动真实 Chromium 浏览器做端到端验证，覆盖 README 第 9 节的验收闭环。测试分两层：

| 套件 | 文件 | 依赖 | 覆盖 |
|---|---|---|---|
| UI 旅程 | `e2e/journey.spec.ts`（10 例） | 无外部依赖（dummy key） | 登录鉴权、渠道/模型/Key 管理页交互、网关调用、登出 |
| 真实集成 | `e2e/realtime.spec.ts`（7 例） | `.dev.vars` 的 `DEEPSEEK_TEST_KEY`（缺失自动跳过） | 真实 DeepSeek 渠道、连接测试、非流式/流式调用、usage 落库 |

### 前置条件

```bash
npm run build:dashboard   # 构建前端（首次或改前端后）
npx wrangler dev --port 8799   # 启动本地 Worker（另一个终端）
```

### 运行

```bash
npm run test:e2e            # 全部（无头）
npm run test:e2e:headed     # 带浏览器窗口（可观察交互）
npx playwright test e2e/journey.spec.ts    # 仅 UI 旅程
npx playwright test e2e/realtime.spec.ts   # 仅真实集成
```

### UI 旅程（10 例，全部通过真实页面操作）

1. 未登录访问 → 跳转登录页（鉴权守卫）
2. 错误 Admin Token → 显示错误
3. 正确 Token → 登录进入 Dashboard
4. Channels：**UI 操作**——预设弹窗选 DeepSeek → 填 API Key → 确认 → 列表出现渠道
5. Models：**UI 操作**——创建模型表单 → 展开实例 → 选渠道下拉 → 填上游 ID/别名 → 提交
6. API Keys：**UI 操作**——创建 Key → 明文一次性展示 → 列表出现
7. 真实 HTTP 调用 `/v1/models` 与 `/v1/chat/completions`（Bearer Key → 上游错误透传）
8. 无认证 → 401
9. Dashboard 显示渠道与模型
10. 退出登录 → 回登录页

### 真实集成（7 例，真实 DeepSeek key）

1. 添加真实 key 渠道
2. 渠道连接测试 → 200 OK
3. 创建模型卡片 + 绑定实例
4. 创建 Gateway Key
5. 非流式调用 → 真实 completion + usage
6. 流式调用 → `[DONE]` + usage chunk
7. admin usage 看板反映调用量

测试自动清理数据库（删除全部渠道/Key/模型），可重复运行。真实 key 只存于 `.dev.vars`（已 gitignore），测试从环境读取，不硬编码。

### E2E 抓出的真实 Bug（已修复）

- 非流式 usage 写入丢失：`__waitUntil` hack 从未生效，改为 `ctx.waitUntil` 贯通
- usage 看板漏当前分钟：`endMinute` 边界差一，`<` 排除当前分钟，改为 `+60`
- 删除 model card 后 `unified_model_id` UNIQUE 被软删行占住：删除时改写为 `deleted:<id>:<ts>` 释放约束
- 删除 channel 后 alias 被占住：级联硬删 instances + identifiers
