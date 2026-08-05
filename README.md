# MyGateway

MyGateway 是一个部署在用户自己 Cloudflare 账号中的轻量 AI API 网关。它统一管理多个
模型供应商，对外提供 OpenAI Chat、OpenAI Responses 和 Anthropic Messages 接口，并以
固定、可解释的顺序完成模型路由、响应前 Fallback 和基础用量统计。

项目优先适配 Cloudflare Free：不需要自建服务器，默认不依赖 KV、R2、Queues 或
Durable Objects。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Leon00x/mygateway)

文档：[架构](docs/ARCHITECTURE.md) · [详细设计](docs/DESIGN.md) ·
[部署](docs/DEPLOY.md) · [测试](docs/TESTING.md) · [更新记录](CHANGELOG.md)

## 1. 产品定位

MyGateway 面向需要统一管理少量 AI 供应商渠道的个人开发者和小型团队，解决以下问题：

- 应用只连接一个 Gateway 地址，不直接散落多个 Provider Key；
- 使用统一模型 ID，按管理员保存的顺序选择渠道；
- 首选渠道在响应开始前失败时自动尝试备用渠道；
- 客户端可以使用 Chat、Responses 或 Messages 协议；
- 在自己的 Cloudflare 账号中保存配置、密钥和统计数据；
- 以较少的 Cloudflare 组件和数据库操作运行在轻量负载下。

典型配置流程：

```text
部署并修改初始密码
  → 添加供应商渠道
  → 创建统一模型并绑定渠道模型
  → 创建 Gateway Key
  → 调用 /v1/chat/completions、/v1/responses 或 /v1/messages
```

### 产品原则

- **固定路由**：默认使用保存后的固定优先级，不做随机、轮询或动态成本调度。
- **原生优先**：客户端协议优先转发到供应商同协议端点。
- **有限转换**：只转换明确支持的 Chat / Messages 公共子集，不能无损表达时直接报错。
- **响应前回退**：一旦向客户端提交响应字节，不再跨渠道续接。
- **隐私优先**：不保存 Prompt、Response 或完整请求日志。
- **统计不冒充账单**：Token 和余额以 Provider 返回值为准，未知用量单独标记。
- **需求先确认**：新需求先讨论目标、范围和取舍；确认后先更新 PRD，再开始设计与实施。

## 2. 快速部署

### Deploy Button

1. 点击上方按钮并登录 Cloudflare；
2. 选择或 Fork `Leon00x/mygateway`；
3. Cloudflare 创建 Worker `mygatewaydemo`、Static Assets 和 D1 `mygateway-db`；
4. 部署脚本运行 migrations，并初始化管理员密码和 `MASTER_KEY`；
5. 保存部署日志中只显示一次的 `MASTER_KEY`；
6. 打开 `https://mygatewaydemo.<你的 workers.dev 子域>.workers.dev`。

首次账号为：

```text
用户名：admin
密码：mygateway123
```

首次登录必须修改用户名和密码。固定初始密码不是长期凭据；`MASTER_KEY` 用于加密
Provider Key，一旦丢失或替换，已有密文将无法解密。

### 本地部署

```bash
git clone https://github.com/Leon00x/mygateway
cd mygateway
npm install
npx wrangler login
npm run deploy
```

自动部署、Secrets、migration 和排障见 [部署指南](docs/DEPLOY.md)。

## 3. 已实现能力

| 能力 | 当前行为 |
|---|---|
| 管理认证 | D1 单管理员账号、HttpOnly Session、首次强制改密 |
| 渠道 | 预制或自定义 Provider，一份 Key 配置多个协议端点；按需发现、刷新和手工维护模型库存 |
| 模型 | 从渠道库存勾选导入，或从 30 个常见模板/自由输入创建；统一模型、渠道实例、可编辑 ID 和稳定直达别名 |
| Gateway Key | 创建、一次性展示、启停、删除和重新生成 |
| 协议 | OpenAI Chat、OpenAI Responses、Anthropic Messages |
| 协议转换 | Chat ↔ Messages 的文本、工具调用、usage 和 SSE 公共子集 |
| 路由 | 原生协议优先、固定优先级、完整别名直达 |
| Fallback | 连接错误、超时、408、429、部分 5xx 和可靠额度不足错误 |
| 被动熔断 | 连续故障后在当前 isolate 冷却，不主动探测 Provider |
| 流式 | SSE 增量解析与透传，客户端取消向上游传播 |
| 用量 | Provider 上报 Token、未知用量、请求量、错误和 Fallback |
| Provider 余额 | DeepSeek 官方账户余额按需查询和 5 分钟短缓存 |
| 控制台 | 左右布局、可收缩侧边栏、浅色/暗黑主题 |
| 可观测性 | 脱敏结构化日志、`X-Gateway-Timing`、`Server-Timing`、`/health` |

### 渠道管理交互

- 预置渠道只要求用户输入 Key；服务端按已确认的供应商元数据写入 Chat、Responses、Messages
  等原生协议，模型列表不得用于推测协议能力。
- 添加渠道必须先明确执行“检测连接与模型”，并在提交前展示协议、检测结果和模型列表；
  检测阶段不创建渠道、不写 D1，连接信息或 Key 改动后必须重新检测。
- 渠道页使用响应式竖向卡片网格。卡片展示状态、协议、缓存余额、套餐余量占位、模型总数和
  最多 3 个模型预览；其余模型以 `+N` 表示，避免大量模型撑高卡片。
- 卡片高频操作为“编辑”和“测试”；“编辑”进入统一详情，包含基础配置、协议、余额和模型。
  启停、删除等低频操作收纳到更多菜单。
- 渠道保存成功后在详情顶部展示一次轻量完成动效和持续可见的成功状态；动画必须支持系统
  `prefers-reduced-motion`，不能阻塞余额查询、模型导入或后续操作。
- 多渠道摘要使用批量查询，不按卡片产生模型库存 N+1 查询；模型发现和余额仍只由用户创建、
  编辑或刷新触发，不使用 Cron。
- 套餐余量本期只预留展示和 adapter 边界，未接入时明确显示“暂未接入”，不生成估算值。
- 完成检测后展示可勾选的模型清单，默认全选并支持全选、取消全选和逐项选择。“保存”只保存
  渠道及完整模型库存，“保存并导入网关”只导入已勾选模型并显示选中数量。检测失败代表已经
  完成一次预检，允许用户仅保存后手工维护；没有勾选模型时禁用导入操作。支持的余额查询仍在
  渠道保存成功后自动执行一次。
- 删除渠道前展示关联实例和受影响统一模型数量。有其他渠道实例的模型只移除当前渠道实例；
  失去最后实例的模型在确认后软删除，历史 usage 保留，避免留下仍可见但无法路由的模型。
- 预置渠道在编辑页只读展示服务端声明的协议与端点，只允许修改名称和 Key；自定义渠道才允许
  编辑协议地址。DeepSeek 预置包含官方 Chat 与 Anthropic Messages 端点。

### 供应商预制

当前包含 OpenAI、Anthropic、DeepSeek、Z.AI、华为云（中国）、阿里云国际、
火山国际（BytePlus）、Google Gemini、Groq、MiniMax 国际、xAI 和 Mistral AI。

预制只声明经过确认的原生协议。用户只需输入一次 Key，系统会创建该供应商已知的协议
端点；未知能力不会自动开启。

### 对外接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/models` | 列出统一模型和公开别名 |
| POST | `/v1/chat/completions` | OpenAI Chat Completions |
| POST | `/v1/responses` | OpenAI Responses；当前只走原生 Responses 渠道 |
| POST | `/v1/messages` | Anthropic Messages；可在必要时与 Chat 转换 |
| GET | `/v1/openapi.json` | OpenAPI 文档 |
| GET | `/v1/api-docs` | API 文档页面 |
| GET | `/health` | 不暴露配置和 Secret 的健康检查 |

Chat 调用示例：

```bash
curl https://your-gateway.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-model","messages":[{"role":"user","content":"Hello"}]}'
```

协议能力和转换边界见 [详细设计](docs/DESIGN.md)。

## 4. Cloudflare Free Tier First

免费档适配是 MyGateway 的核心产品特点。默认部署只使用：

```text
1 个 Worker（包含 Static Assets）
1 个 D1 数据库
2 个首次部署 Secrets
1 个每日 Cron Trigger
```

截至 2026-08-05，与本项目最相关的官方 Free 限制如下。额度可能变化，部署前应同时查看
[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)、
[D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) 和
[D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)。

| 项目 | Free 限制 | MyGateway 的控制方式 |
|---|---:|---|
| Worker 请求 | 100,000/天 | 建议轻量使用不超过约 10,000 次网关调用/天 |
| Worker CPU | 10ms/请求 | 流式转发、有限解析，不缓存完整响应 |
| 外部子请求 | 50/请求 | 最多尝试 3 个 Provider，候选串行而非广播 |
| 并发出站连接 | 6/请求 | 单请求顺序尝试渠道 |
| D1 读取 | 5,000,000 行/天 | 索引、一次 batch、短 TTL isolate 缓存 |
| D1 写入 | 100,000 行/天 | 每个完成请求一次 usage UPSERT，不保存原始请求 |
| D1 存储 | 500MB/数据库、账号总计 5GB | 一个数据库，只保留配置和 30 天分钟聚合 |
| Workers Logs | 200,000 事件/天、保留 3 天 | 10% head sampling 和脱敏事件 |

### 我们如何减少额度消耗

- 热请求使用有容量上限的 isolate 内存缓存；缓存命中时不查询 D1。
- 冷请求通过一次 `DB.batch()` 完成 Gateway Key 鉴权与模型路由。
- SSE 按事件增量处理，不把完整生成结果读入内存。
- 用量只写分钟聚合；失败候选不会分别写统计记录。
- 用量写入通过 `waitUntil()` 异步执行，失败不阻断模型响应。
- 每日 Cron 只清理过期统计，不执行余额、模型同步或健康探测。
- 熔断状态保存在 isolate 内存，不使用 KV、DO 或额外数据库写入。
- DeepSeek 余额只有用户主动刷新时才访问 Provider，并缓存 5 分钟。
- 不引入 Pages、KV、R2、Queues、Durable Objects 或额外后台服务。

### 边界与超额行为

MyGateway 是“优先适配 Free”，不是无限流量保证。实际容量取决于模型数、缓存命中率、
D1 索引写放大、Cloudflare 账号中的其他 Worker，以及异常或恶意流量。

- D1 达到每日读写额度后会拒绝查询，配置路由可能返回 503；
- usage 写入或看板查询失败不会中断已经完成的模型响应；
- Workers 达到每日请求或 CPU 限制后由 Cloudflare 拒绝请求；
- Provider 模型调用费用与 Cloudflare 免费额度相互独立，MyGateway 不替用户承担上游费用；
- 如果代表性负载持续接近额度，应降低统计/日志开销或升级 Workers Paid，不能静默牺牲
  安全校验和流式正确性。

## 5. 安全和数据边界

- Provider Key 使用 `MASTER_KEY` 通过 AES-GCM 加密后写入 D1；
- Gateway Key 只保存 SHA-256 hash，明文只展示一次；
- 管理密码使用带随机盐的 PBKDF2-SHA256 摘要；
- 管理 Session 使用 HttpOnly、Secure、SameSite=Strict Cookie；
- 管理写操作执行同源检查；
- Base URL 只允许合法 HTTPS 地址；
- 日志不记录 Key、Authorization、Prompt 或 Response 正文；
- 请求体和上游错误体均有大小限制；
- D1 是配置的唯一权威数据源，内存缓存可随时丢失。

## 6. 当前产品边界

当前明确不包含：

- Responses 与 Chat / Messages 之间的协议转换；
- Gemini 原生协议、Embeddings、Images、Audio、Realtime、Batch 和 Files；
- 同渠道自动重试、流输出后的 Fallback；
- 动态价格路由、自动套餐扣减和精确账单；
- OAuth Provider、多用户、RBAC、Key 级 RPM/TPM 和预算；
- Prompt/Response 存储或响应缓存；
- 跨 isolate 强一致的熔断、限流或预算状态。

## 7. Roadmap

近期：

- 使用 OpenAI SDK 验证 Chat 和原生 Responses 的真实流式/非流式调用；
- 使用 Anthropic SDK 验证原生 Messages 和 Messages → Chat 转换；
- 完善自定义渠道的协议端点编辑校验和变更影响提示；
- 完善 Anthropic 错误 envelope 和图片内容公共子集；
- 建立 Free Tier 生产指标基线：CPU、D1 rows read/write、缓存命中率。

后续候选：

- Provider Adapter 能力矩阵与更多官方余额接口；
- Responses ↔ Chat 转换；
- 手工成本估算和预算展示；
- API Key 模型权限与轻量限流；
- 多用户和 RBAC；
- 只有需要共享强状态时再评估 Durable Objects。

Roadmap 不是已承诺的发布日期，已发布变化以 [CHANGELOG](CHANGELOG.md) 为准。

## 8. 开发与验证

```bash
npm install
npm run dev:setup
npm run dev

npm test
npm run typecheck
npm run build
npm run test:e2e
```

当前测试包括 66 个单元测试、11 个无需真实 Provider Key 的 UI E2E，以及 10 个需要真实
`DEEPSEEK_TEST_KEY` 的集成测试。环境准备、用例清单和运行边界见
[测试指南](docs/TESTING.md)。
