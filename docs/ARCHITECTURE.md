# MyGateway 技术架构

本文只描述当前已实现的系统结构和关键技术决策。产品特性见 [PRD](PRD.md)，
协议与供应商细节见 [详细设计](DESIGN.md)，部署与测试分别见
[DEPLOY](DEPLOY.md) 和 [TESTING](TESTING.md)。

## 1. 系统边界

MyGateway 的控制面和数据面部署在同一个 Cloudflare Worker：

```text
浏览器 ── Static Assets ── SolidJS 控制台
管理员 ── /admin/api/* ── Session 鉴权 ── D1
客户端 ── /v1/* ── Gateway Key ── 模型解析 ── AI Provider
                                             └─ usage 聚合 ── D1
Cron ── 每日清理过期 usage_minutes、analytics_minutes、
        request_logs、key_daily_usage 与加密上下文预览
```

默认只使用一个 Worker（包含 Static Assets）、一个 D1、两个部署 Secret 和一个每日 Cron，
不依赖 Pages、KV、R2、Queues 或 Durable Objects。

## 2. 代码模块

```text
src/
├── admin/       管理 API、渠道、模型、Key、用量、系统和余额
├── auth/        管理 Session、密码和 Gateway Key
├── cache/       isolate TTL/LRU 缓存
├── crypto/      Provider Key AES-GCM
├── db/          D1 查询与写入
├── gateway/     协议入口、模型解析、转换、Fallback 和代理
├── http/        错误、Header 和 Request ID
├── streaming/   SSE 增量解析
└── shared/      ID、日志和供应商预制

dashboard/src/   SolidJS 管理控制台
e2e/             Playwright 测试
migrations/      D1 增量 migration
```

HTTP 路由调用领域模块，领域模块调用 `db/*` 和基础工具；数据库层不依赖 HTTP；前端不
直接访问 D1 或任何部署 Secret。

## 3. 控制面与数据面

控制面负责管理员认证、渠道与协议端点、统一模型、Gateway Key、用量看板、Provider 余额
和系统状态。管理写操作更新 D1，并清除当前 isolate 的相关缓存；其他 isolate 通过短 TTL
收敛。

数据面请求流程：

1. 限制请求体并校验认证 Header；
2. 计算 Gateway Key hash，查询 isolate 缓存；
3. 缓存未命中时，用一个 D1 `batch()` 完成 Key 鉴权和模型候选解析；
4. 按客户端协议选择原生候选或允许的转换候选；
5. 解密最终候选的 Provider Key，重建上游 URL、Header 和请求体；
6. 按固定顺序调用 Provider，并在响应提交前执行 Fallback；
7. 接受最终响应后锁定渠道；
8. 通过 `waitUntil()` 异步汇总一次 usage。

## 4. D1 数据模型

| 表 | 用途 |
|---|---|
| `admin_users` | 单管理员密码摘要、首次改密和 Session 版本 |
| `channels` | 供应商渠道、预制标识、短代码、加密 Key 和状态 |
| `channel_protocols` | 渠道的 Chat、Responses、Messages 原生端点 |
| `channel_provider_models` | 按渠道保存发现或手工维护的上游模型库存；不直接决定路由 |
| `channel_model_discovery` | 最近一次按需发现的状态、结果摘要和时间 |
| `model_cards` | 统一模型 |
| `channel_models` | 上游模型 ID、公开别名和固定顺序 |
| `model_identifiers` | 统一模型 ID 与别名的全局命名空间 |
| `gateway_api_keys` | Gateway Key hash、短 prefix 和状态 |
| `key_daily_usage` | 每密钥每日用量与预算扣减台账 |
| `usage_minutes` | 按分钟、模型、最终渠道聚合的用量 |
| `request_logs` | 请求明细日志（可选），含脱敏错误与加密上下文预览 |
| `analytics_minutes` | 5 分钟聚合桶：密钥、统一模型、最终渠道维度，含输入、缓存命中、输出 Token，以及 TTFT、延迟与回退样本 |
| `model_prices` | 可编辑模型基准价库：30 个内置 USD 基线，输入 / 输出 / 缓存价（micros / 百万 Token）与币种 |
| `system_settings` | 少量系统设置；`public_url` 保存控制台确认的规范 HTTP(S) Origin |

关键约束：

- 统一模型 ID 和公开别名全局唯一；
- Provider Key 只保存 ciphertext、IV 和版本；
- Gateway Key 只保存 hash；
- usage 保存名称快照，配置删除后仍可显示历史统计；
- migration 是 Schema 的权威来源，文档不复制完整 SQL。

`public_url` 通过管理员会话保护的专用端点读写，服务端统一移除尾部 `/` 并拒绝路径、查询、
锚点与凭据。Dashboard 在未配置时使用浏览器当前 Origin；配置后只将它用于展示、复制命令和
Skill 引导，不参与请求路由，也不会自动配置 Cloudflare DNS。

`analytics_minutes` 每个完成请求至少 UPSERT 一次。5 分钟聚合减少数据行数量，但不减少更新
次数；新行还会写入索引，因此容量评估必须以 D1 的 `rows_written` 为准。`usage_minutes` 只保留
为旧版本历史归档，并随保留期清理，不再由网关写入。

Provider 上报的缓存命中 Token 是输入 Token 的子集。聚合层同时保存总输入与缓存命中量；展示
“输入（非缓存）”时使用 `input_tokens - cache_input_tokens`，总 Token 仍为输入加输出。迁移前的
历史聚合无法反推缓存命中量，按 0 处理。

Analytics 趋势接口在 30 天保留期内返回完整时间桶（5 分钟粒度最多 8,640 个），不截断范围尾部。
控制台再按可视宽度合并展示桶；这只改变绘图密度，不改变汇总统计或原始聚合数据。

当前 `cost_micros` 系列字段没有币种维度：实例和价格库虽保存 USD / CNY 元数据，聚合层并不
换汇或拆分。这是 0.1.x 的已知数据模型缺口；修复前同一部署应统一使用一种记账币种。

## 5. 认证和密钥

### 管理员

- 首次有效登录在 D1 创建管理员；
- 密码使用带随机盐的 PBKDF2-HMAC-SHA256 摘要；
- Session Cookie 由 `MASTER_KEY` 派生密钥签名；
- Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Strict`；
- 修改凭据递增 Session 版本，使旧会话失效；
- 完成首次改密前，其他管理接口不可用；
- 管理写请求执行同源检查。

### Gateway Key

Gateway Key 以 `gw_` 开头，明文只在创建或重新生成时返回一次。数据面计算 SHA-256 后与
D1 中的 hash 比较。短 prefix 只用于控制台辨认。`expires_at` 使用 Unix 秒存入 D1；数据面在
执行 RPM 与周期预算检查前判断到期时间，过期请求返回 401，控制台也会将其排除出有效密钥计数。
请求与 Token 预算共用 `limit_period`，按 UTC 自然日、ISO 周（周一开始）、自然月或自然年重置。
完成请求仍只写 `key_daily_usage` 一条日聚合；检查时利用 `(key_id, date)` 主键做当前周期范围
SUM，不维护重复的周/月/年表。年度预算要求该台账至少保留 370 天，与 Analytics 默认 30 天
保留期分离。

首页快速调用是唯一的明文暂存例外：用户主动创建临时密钥后，服务端设置
`is_temporary = 1` 并强制 `expires_at = now + 1h`，不接受续期、限额修改或重新生成。列表查询
直接排除已过期的临时密钥；后续创建或删除任意 Gateway Key 时，顺带删除已过期临时记录，
不增加 Cron 任务。控制台将 `{ key, expiresAt }` 写入同源 `localStorage`，刷新时只恢复尚未到期
的值，并用定时器在到期后清除。该机制不增加服务端明文存储，也不会通过管理 API 找回已创建
密钥；共享浏览器或高 XSS 风险环境不应使用这一便利功能。

### Provider Key

Provider Key 使用 AES-256-GCM 加密。每次加密使用随机 IV，渠道 ID 和 key version 参与
AAD。Key 只在即将调用 Provider 时于 Worker 内解密，不进入响应、D1 明文或日志。

### Management Key

Management Key 以 `mgmt_` 开头，D1 只保存 SHA-256 hash、短前缀、`read` / `write` 权限、状态与
到期时间；永久密钥在数据库使用 Unix 秒上限哨兵值，对外表示为 `expires_at: null`。控制台创建
时只返回一次明文；为方便配置 Agent，当前浏览器可在同源
`localStorage` 中保留最多 1 小时，到期、删除或主动清除后无法从服务端找回。

Management API 审计只写 Key ID、HTTP 方法、路径、状态和 Request ID，不保存查询字符串、请求体
或响应体，并由现有单个每日 Cron 按 Usage 保留天数清理。Provider Key 仍只在渠道写请求进入
Worker 内存，并且渠道、日志和错误响应都会移除明文、hash、IV、tag 与 ciphertext。

Skill 源码以根目录 `skills/mygateway-admin/SKILL.md` 为唯一权威；Vite `closeBundle` 阶段将其
发布为 Dashboard 静态产物 `/skill.md` 与 `/skill.json`，并生成 `/skills/index.json`。因此每个部署实例都
能从自己的同源网站分发 Skill，不需要依赖代码仓可用性，也不会把 Management Key 写入产物。
Management Key 的跨会话保存由 Agent 平台凭据存储负责；仅当平台无此能力时，Skill 才允许使用
仓库外、`0600` 权限的本地配置文件。该文件不属于 MyGateway 服务端状态，也不会随构建发布。

## 6. 模型与协议解析

客户端 `model` 有两种命中方式：

- **统一模型 ID**：返回固定顺序候选，允许响应前 Fallback；
- **完整公开别名**：只返回指定渠道实例，不跨渠道 Fallback。

协议选择规则：

1. 优先选择与客户端协议相同的 Provider 原生端点；
2. Chat 与 Messages 可以在支持的公共子集内互转；
3. Responses 当前没有转换路径，只选择原生 Responses；
4. 没有可表达候选时返回明确错误，不静默删除字段。

转换矩阵见 [DESIGN](DESIGN.md)。

## 7. 上游代理和 Fallback

渠道保存协议根 URL，代理按协议追加 `/chat/completions`、`/responses` 或 `/messages`。
Base URL 必须是 HTTPS，不能包含用户名、密码、query 或 fragment，并保留合法路径前缀。

上游 Header 由网关重建。Provider 认证按端点配置使用 Bearer 或 `x-api-key`；客户端的
Gateway Key 不会转发给 Provider。

可回退故障包括连接失败、Header 超时、`408`、`429`、部分 `5xx` 和可靠识别的额度不足。
普通 `4xx` 通常代表请求无效，不跨渠道重试。

```text
候选选择 → 请求上游 → 等待响应头 → 接受响应 → 提交客户端
               │             │
               └── 可回退 ───┘
```

接受响应后渠道锁定；向客户端提交字节后绝不跨渠道续接。每个请求最多尝试
`MAX_CHANNEL_ATTEMPTS` 个渠道，默认 3。客户端取消会终止当前上游请求。

### 被动熔断

渠道连续 3 次出现可回退故障后，在当前 isolate 冷却 30 秒。冷却结束后的下一次真实请求
作为恢复探测。状态最多保存 500 个渠道，不写 D1/KV/DO，也不主动调用 Provider。

完整公开别名保持直达语义；如果指定渠道正在冷却，直接返回暂时不可用。

## 8. 流式和用量

网络 chunk 不等于 SSE event。增量 decoder 支持事件跨 chunk、单 chunk 多事件、UTF-8
跨 chunk、多行 `data:`、缺少尾部空行和 `[DONE]`。

同一上游流一支立即输出客户端，另一支增量解析 usage；实现不缓存完整模型输出。完成、
错误和取消路径共享幂等 finalizer，保证一个客户端请求最多写一次聚合统计。

Provider 未返回可信 Token、流中断或 JSON 损坏时记录 `usage_unknown`，不本地猜测 Token。
usage 写入失败只记录脱敏错误，不修改已经返回的模型响应。

## 9. 缓存与一致性

缓存全部位于 Worker isolate 内：

| 缓存 | TTL | 容量 |
|---|---:|---:|
| 有效 Gateway Key | 30 秒 | 1,000 |
| 无效 Gateway Key | 5 秒 | 共用 Key 容量 |
| 成功模型路由 | 60 秒 | 200 |
| 不存在/不可用模型 | 5 秒 | 共用路由容量 |
| Key 周期预算快照 | 30 秒（可配置） | 5,000 |
| DeepSeek 余额 | 5 分钟 | 200 |
| 被动熔断状态 | 冷却 30 秒 | 500 |

只有配置了请求或 Token 预算的 Key 才创建预算快照；每个 Key、每个 isolate 在刷新窗口内最多执行
一次 D1 范围查询，冷缓存并发查询会合并，并把本 isolate 已完成请求追加到本地账本。其他 isolate
在窗口内完成的用量要到下次刷新才可见，因此可能发生有界超额。缓存不是权威存储，isolate 回收后
自动回源 D1。Gateway
Key 撤销跨 isolate 最长约 30 秒，渠道和模型变更最长约 60 秒收敛。全局即时失效或强一致限流
需要新的共享状态设计。

## 10. HTTP 与管理 API

| 前缀 | 用途 |
|---|---|
| `/v1/*` | Gateway、模型列表和 API 文档 |
| `/admin/api/auth/*` | 登录、Session、退出和修改凭据 |
| `/admin/api/channels*` | 渠道、连接测试、预检（preflight）、Provider 余额、模型发现/库存/导入 |
| `/admin/api/models*` | 模型卡片、可选渠道绑定、实例和排序 |
| `/admin/api/keys*` | Gateway Key 生命周期 |
| `/admin/api/analytics/*` | 用量聚合、日志查询、日志设置（当前用量与日志主路径） |
| `/admin/api/usage*` | 首页用量概览与维度统计 |
| `/admin/api/model-prices*` | 模型价格库（列表 / 批量 upsert / 单条删除） |
| `/admin/api/system*` | 系统状态、设置和 Provider 预制 |
| `/admin/api/management-keys*` | 仅管理员 Session 可用的 Management Key 生命周期 |
| `/management/v1/*` | Agent / 自动化使用的版本化 Management API；`read` / `write` Bearer 鉴权 |
| `/health` | 最小健康检查 |

Gateway 错误使用稳定 JSON envelope 并附带 Request ID。Provider 已返回明确响应时尽量保留
其状态；网关自身的认证、路由、协议和超时错误使用统一错误码。

`GET /management/v1/capabilities`、`/management/v1/openapi.json` 与
`/management/v1/api-docs` 用于公开发现；`/v1/api-docs` 也可在数据面与管理面规范间切换。其余 Management
路由只开放渠道、余额、模型、Gateway Key、用量、脱敏日志和系统状态。日志详情始终移除加密
上下文字段，即使管理员曾开启上下文记录。日志设置、清空日志、管理员账号和 Management Key
签发不在机器 API 白名单内。

`GET /management/v1/overview` 是需鉴权的只读初始化接口。渠道与协议、模型与实例分别使用批量查询，
Gateway Key 复用脱敏列表逻辑；余额只读当前 isolate 缓存，避免一次 Agent 连接触发外部请求。接口
通过 `setup_state` 表达配置阶段，不返回 Provider 端点、任何 Key 明文/前缀或加密材料。

渠道卡片使用 `GET /admin/api/channels/overview`：一次返回脱敏渠道、当前 isolate 的余额缓存，
以及通过单条索引查询得到的模型数量和最多 3 个预览，避免前端按渠道产生 N+1 请求。

## 11. 管理前端

管理端使用 SolidJS、Vite 和 Worker Static Assets。根路径 `/` 是公开项目首页，管理控制台概览位于
`/console`，并包含登录、首次改密、Channels、Models、API Keys 和 System。侧边栏可收缩，主题偏好
保存在浏览器 localStorage。

控制台和 Worker 共用 `src/shared/provider-presets.ts`，避免供应商预制漂移。Worker 和
Dashboard 分别由根 `tsconfig.json` 与 `tsconfig.dashboard.json` 严格检查；前端不接触
`MASTER_KEY` 或 Provider Key 明文。

## 12. 可观测性与降级

结构化事件记录协议、模型、最终渠道、状态、耗时、尝试次数、Fallback、缓存和 D1 时间，
不记录 Key 或 Provider Key。请求/响应正文预览默认不保存，仅在显式开启“记录上下文”后
加密存储（4 KiB 上限、短期保留）。

- `X-Gateway-Timing`：稳定的缓存、D1、访问解析、上游首包和网关首包耗时；
- `Server-Timing`：尽力提供，可能被 Cloudflare 平台覆盖；
- `/health`：不查询 Provider，不泄露渠道、D1 或 Secret 状态。

降级原则：usage 或看板失败不影响数据面已有响应；D1 配置查询失败时返回 503；余额失败
只影响余额卡片；CPU 接近 Free 限制时不放弃认证、输入校验或流式正确性。

Cloudflare 预算与 Free Tier 容量规划见 [DEPLOY](DEPLOY.md)。

## 13. 运行配置

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `APP_VERSION` | `0.1.0` | 应用版本 |
| `INITIAL_ADMIN_USERNAME` | `admin` | 首次管理员用户名 |
| `DEFAULT_TIMEZONE` | `Asia/Shanghai` | “今日”统计时区 |
| `MAX_REQUEST_BYTES` | `2097152` | Gateway JSON 请求体上限 |
| `MAX_CHANNEL_ATTEMPTS` | `3` | 单请求最多尝试渠道数 |
| `UPSTREAM_HEADER_TIMEOUT_MS` | `30000` | 每候选等待响应头上限 |
| `KEY_QUOTA_REFRESH_MS` | `30000` | 有限额 Key 每 isolate 刷新 D1 周期预算快照的间隔 |
| `USAGE_RETENTION_DAYS` | `30` | 用量保留天数 |

Secrets：`MASTER_KEY`、`INITIAL_ADMIN_PASSWORD`，以及仅用于旧部署迁移的 `ADMIN_TOKEN`。
生产绑定与初始化见 [DEPLOY](DEPLOY.md)。
