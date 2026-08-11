# MyGateway 更新日志

本文记录已发布变化和明确标记的待发布变化。产品特性与 Roadmap 见
[PRD](PRD.md)；技术细节分别见[架构](ARCHITECTURE.md)、
[详细设计](DESIGN.md)、[部署](DEPLOY.md)和[测试](TESTING.md)。

## 未发布：仓库整理与接续开发基线

- System 页在管理员账号卡片旁新增网站访问域名设置：默认检测当前 Origin，显式保存规范
  HTTP(S) 地址，并同步用于首页接入地址、curl 命令与 Agent Skill 提示词；服务端拒绝包含路径、
  查询、锚点或凭据的输入，UI 与 API E2E 覆盖校验和传播行为。
- `mygateway-admin` Skill 升级至 0.2.0，增加首次连接快速指引，并在 Skill 内要求每次使用前检查
  `/skill.json`、发现新版本后先更新；System 提示词只保留托管 Skill 的安装入口。构建生成的
  Skill 索引直接读取 manifest 版本，避免发布元数据漂移。
- 新增 Agent 管理入口：独立 `mgmt_` Management Key（只读 / 可写、到期、停启、删除、
  最近使用时间）、版本化 `/management/v1` 能力发现与资源白名单，以及不记录请求体的操作审计。
  System 页可生成最多保留 1 小时的一键 Agent 配置提示词；官方 `mygateway-admin` Skill 覆盖渠道、
  模型、Gateway Key、余额、用量、日志与诊断。Provider Key 和日志上下文不会从该 API 返回。
- 管理密钥卡片默认只展示最近 3 条，按需展开全部；创建配置仅在点击创建按钮后出现，并支持
  永久有效期，避免低频表单长期占据系统设置页面。
- 官方 Skill 以自包含的 `/skill.md` 和 `/skill.json` 随 Dashboard 托管，不依赖代码仓、本地脚本
  或额外参考文件。配置提示词始终显示；创建后最多 1 小时填入真实 Key，之后恢复安全占位符。
  修正 Analytics 自定义范围参数为实际支持的 `start` / `end`，补充 API 版本检查、写请求歧义
  处理、内部 ID、分页和临时 Gateway Key 约束。

- 根目录文档收敛为 README；更新日志、贡献指南与安全策略归档至 `docs/` 并修复全部相对链接。
  `LICENSE` 与 Agent 自动发现所需的 `AGENTS.md` 继续保留在根目录；清理离线参考页和本地构建、
  测试产物，不把生成文件纳入源码。
- 渠道接入统一为 Chat、Responses、Messages 三行协议编辑器：预置协议默认勾选并预填官方
  Base URL，预置与自定义渠道均可按实际端点修改；渠道卡片同时显示协议与完整请求 path。
- 修复英文界面仍显示中文预置渠道名：供应商预置使用英文规范名和可选中文名，渠道卡片、选择器、
  详情及编辑弹窗按当前语言展示，并兼容历史中文默认名；管理员自定义名称不受影响。
- Admin API 拒绝相同供应商/端点集合重复配置同一 Provider Key，也拒绝统一模型重复绑定同一
  渠道，返回明确的 `409 resource_in_use`；E2E 增加重复渠道、重复模型实例回归覆盖。
- 全站浏览器原生 `alert` / `confirm` 替换为统一应用内 Dialog；自定义渠道与自定义模型改为模态
  创建流程，修复渠道卡片更多菜单溢出，并补充供应商品牌色 monogram 与中英文文案。
- 新增独立 Admin API E2E 回归：覆盖渠道协议校验、编辑与重复 Key，库存 CRUD，模型 CRUD、
  实例冲突、定价与排序，导入幂等，以及 Gateway Key/模型/协议不可用的 HTTP 错误矩阵。
- 新增无需真实 Provider Key 的可控上游 E2E：通过真实 Worker HTTP 链路验证 `429`、`503`、
  连接失败与响应头超时 Fallback，锁定 `401` 不重试、流开始后不跨渠道续接和客户端取消传播；
  同时校验 Provider 鉴权头与渠道模型 ID 转发。

- README 重写为开源项目入口，明确 public alpha 定位、15 个供应商预制、快速部署、适用边界
  和文档导航；新增根 `AGENTS.md` 作为 AI 接续开发约束。
- `npm run typecheck` 现在同时严格检查 Worker 与 Dashboard；修复由此发现的重复 i18n key、
  SolidJS 类型错误和无类型空集合，并移除仅用于旧地址跳转的冗余页面组件。
- Secret 初始化改为读取当前 Wrangler 配置，不再把 Worker 名写死，支持 Deploy Button Fork
  后自定义名称；Worker dry-run 显式选择顶层环境，消除多环境警告。
- 审计确认费用聚合缺少币种维度；PRD 将其列为稳定版前 P0，不再宣称混合 USD / CNY 时
  费用汇总准确。管理登录失败限速也列入 P0。
- 日志设置区从请求日志页移入系统设置页（总开关、级别、上下文与保留期）；模型价格库
  折叠为可展开的小卡片，点击“配置价格”后展示完整列表；管理员头像菜单移除“修改登录
  凭据”入口（首次登录强制改密流程保留）；侧边栏品牌 Logo 放大至 40px。
- 修复首页临时密钥创建后的控制台编译异常；首页临时密钥增加 D1 服务端标识并强制 1 小时
  到期，不允许续期或重新生成，列表不展示已过期记录，并在后续创建 / 删除 Key 时惰性清理而
  不占用 Cron；明文与到期时间在当前浏览器中保存至失效，刷新后可继续复制且不会重复创建。
  首页快速调用默认使用最早创建的可用模型。API 密钥页支持直接选择精确到期时间、
  展示已过期状态和续期入口，创建、复制、限额、启停与删除按钮统一增加语义图标。
- API 访问密钥创建表单改为 1 / 7 / 30 / 90 天与永久期限预设，统一名称、期限和操作区的控件
  基线；管理密钥运行状态改为无底色的圆点与文字，在亮暗主题下保持一致。
- Dashboard 新增协议路径选择、缓存命中率和 1 小时快速调用；OpenAI Chat 透传时将
  `developer` 角色规范化为 `system`，以兼容不接受该角色的上游。
- 用量分析将“平均流式 TTFT”改为“平均首 Token 延迟”，明确注明仅统计流式请求；没有流式
  样本时显示 `—`，避免被误解为 0 ms。
- Analytics 用量与日志页增加用途副标题，分段导航改为轻量胶囊样式；时间、模型、密钥、粒度
  等筛选控件统一高度、圆角和间距，并按桌面、平板和手机宽度自适应排列。
- “清空日志”从请求日志查询页移入 System 的日志设置模块，与保存策略分层展示；保留不可恢复
  确认，并明确该操作不影响 Analytics 用量与费用聚合。
- 重点维护的 10 个供应商预制更新为当前稳定模型，移除 Groq 预览模型和旧 OpenAI、Anthropic、
  Mistral 建议；30 个常见模型模板改为显式清单，不再受预制卡片排序影响。
- 新增 30 个主流模型的 2026-08-11 USD 按量价格基线与官方来源；升级 migration 只替换仍等于
  旧种子值的条目，保留管理员自定义价格。新增供应商 / 模型文档，说明 DeepSeek 余额、MiniMax
  Token Plan 配额以及其他 MaaS / 控制面凭据的接入边界。

## 2026-08-10：价格库与产品化整理

- 新增模型价格库（`model_prices`）：管理员维护模型基准价（输入/输出/缓存，USD/CNY），
  渠道导入时自动预填；计费优先级为渠道实例价 > 价格库基准价 > 未定价不计费。
- 缓存命中 Token 按缓存价计算费用（`computeCostMicros`），费用汇总到用量、密钥日用量与首页。
- 新增 `/admin/api/model-prices`（GET/PUT/DELETE）；本地开发允许 loopback HTTP 渠道
   （`scripts/mock-provider.mjs` 用于无真实 Key 的端到端验证）。
- 管理控制台中英双语（i18n），顶部语言开关，选择持久化。
- Analytics 页面重构：时间范围选择器（今日/7 天/30 天/自定义 + 粒度）、QwenCloud 风格
  指标卡、Request trend 折线图与 Token consumption 堆叠柱状图（真实时间轴）。
- 新增 [PRD](PRD.md)（特性总表 + 分模块详述 + 边界 + Roadmap），README 精简为
  入口文档；根目录废弃 `logo.png` 移除（品牌图统一放 `dashboard/public/`）。

## 2026-08-08：Analytics 用量与日志重构

- 左侧导航新增 Analytics 分组，包含用量分析和请求日志两个页面；旧 `/requests`
  自动跳转至 `/analytics/logs`。
- 新增 5 分钟 Analytics 聚合桶（`analytics_minutes`），始终记录，不受日志开关影响。
  维度为密钥、统一模型和最终渠道，额外记录流式 TTFT、延迟采样数和回退信息。
- 用量分析页面提供今日 / 7 天 / 30 天筛选、模型和密钥过滤；首屏展示总 Token、预估费用、
  请求量、平均延迟、平均流式 TTFT 和成功率指标卡；下方为模型维度明细表。
- 请求日志页面新增总开关、异常/正常日志、上下文记录设置区；上下文默认关闭，开启需二次确认，
  请求和响应各最多 4 KiB 预览，使用 `MASTER_KEY` 派生密钥做 AES-GCM 加密，列表接口
  绝不返回上下文明文。关闭日志时不写入 `request_logs`，不序列化或加密上下文。
- 日志筛选支持状态、模型、密钥、渠道和精确 Request ID，使用游标分页（`timestamp, id`），
  默认不轮询、不 COUNT，最多 100 条/页。详情抽屉展示路由尝试、回退、Token、费用、延迟、
  脱敏错误和可用上下文预览。
- 完成路径改为一次 D1 `batch()` 提交 analytics 聚合、`key_daily_usage` 和可选
   `request_logs`，由同一个 `waitUntil` 执行，不阻塞上游模型响应。
- 流式请求在首个有效输出时记录 TTFT；非流式请求不进入 TTFT 样本。
- 每日 Cron 新增 analytics 聚合清理，保持与 usage 相同的保留期。
- 迁移 0007 只新增数据库对象（表、列、索引、设置），不修改已发布迁移。
- 当前 19 个测试文件、123 个单元用例通过；新增覆盖聚合数学、三协议有效输出识别、
  TTFT 样本、策略矩阵、批量写入、上下文加解密和截断。

## 2026-08-06：请求日志级别开关与错误详情

状态：已合入 `main`。

- 请求日志页新增两个开关：异常日志（错误/中断/限流/预算超限/无权限/过期）和正常日志（成功）；
  关闭只停止记录明细日志，用量统计与密钥预算扣减不受影响（两者走独立聚合表）。
- 异常日志附带 `error_detail`：上游 HTTP 状态、连接/超时/密钥解密/协议转换错误、流式解析错误，
  截断存储且不含 Prompt/Response。
- 非流式上游错误现在也会写入用量错误计数（此前只有流式错误计入），用量统计更准确。
- 开关存储于 `system_settings`，isolate 60 秒缓存，管理页修改即时生效。

## 2026-08-06：虚拟密钥限额、费用统计与请求日志

状态：已合入 `main`。

- Gateway Key 支持虚拟密钥能力：每分钟 RPM、每日请求/Token 预算、到期时间和模型白名单；
  超额返回 429/403，密钥过期返回 401；管理页可创建和编辑限额。
- 每日预算以 D1 权威扣减（密钥每日聚合表），RPM 为 isolate 内尽力窗口。
- 渠道实例可配置 $/M Token 输入/输出单价，按 Provider 上报 Token 计算费用（整数 micro-USD），
  汇总到用量、密钥每日用量与首页“预估费用”指标。
- 新增请求日志：记录最近请求的密钥、模型、渠道、状态、Token、费用、耗时和回退，管理页
  “请求日志”可筛选查看，默认保留 7 天，每日 Cron 清理。
- 模型页改为竖向卡片布局（对齐渠道页），实例可配置/修改定价。
- 项目标准开源化：MIT License、CONTRIBUTING、SECURITY、GitHub Actions CI。
- 单元测试 93 例。

本文只记录已经合入并部署的用户可见变化。产品特性与 Roadmap 见
[PRD](PRD.md)；技术细节分别见[架构](ARCHITECTURE.md)、
[详细设计](DESIGN.md)、[部署](DEPLOY.md)和[测试](TESTING.md)。

## 2026-08-05：控制台侧边栏与暗黑模式

状态：已合入 `main`，已部署到 Cloudflare Worker `mygatewaydemo`。

- 左侧栏底部按钮改为桌面端展开/收缩控制，收起后保留图标导航并记忆用户选择。
- 退出登录保留在管理员信息行，不再与侧边栏控制混用。
- 右上角新增参考 QwenCloud 的圆形明暗主题切换按钮；首次跟随系统偏好，之后记忆用户选择。
- 暗黑模式覆盖控制台、登录页、弹窗、表单、状态标签和代码区域，移动端继续使用横向导航。
- UI E2E 增加侧边栏切换、主题切换和刷新后主题持久化验证。

## 2026-08-04：多协议路由、供应商预制与 DeepSeek 余额

状态：已合入 `main`，已部署到 Cloudflare Worker `mygatewaydemo`。

- 对外新增 `POST /v1/responses` 和 `POST /v1/messages`，保留现有 Chat 接口。
- 新增 `channel_protocols`，一个供应商渠道可用一份 Key 配置多个原生协议。
- 路由改为原生同协议优先；Responses 没有原生候选时返回明确错误。
- 实现 Chat 与 Messages 的文本、function tools、非流式响应和 SSE 双向转换。
- 转换无法无损表达的字段返回 `unsupported_protocol_feature`，不静默删除。
- OpenAI 预设自动配置 Chat + Responses；新增 Anthropic Messages 预设；自定义渠道可多选协议。
- 新增 Z.AI、华为云（中国）、阿里云国际和火山国际（BytePlus）预制，并校准 DeepSeek；
  多协议供应商只需输入一次 Key 即可自动创建其已确认的原生协议端点。
- 新增 Google Gemini、Groq、MiniMax 国际、xAI 和 Mistral AI 预制；其中 Groq、
  xAI 自动配置 Chat + Responses，MiniMax 国际自动配置 Chat + Messages。
- Worker 管理 API 与 Dashboard 改为共用同一份预制数据，避免两处配置漂移。
- 新增 DeepSeek 官方账户余额查询：渠道页按渠道展示总余额、赠金、充值余额、可用状态和
  更新时间；首页新增独立 Provider Balance 卡片，不跨账户或币种汇总。
- 首次打开页面只读取 5 分钟 isolate 短缓存；只有用户查询或刷新时访问 DeepSeek，且不
  新增 D1/KV/DO 写入或 Cron 探测。
- 协议配置随现有路由 D1 查询和 isolate 缓存返回，不新增免费档组件或每请求查询。
- 新增协议选择、请求/响应转换、任意 SSE 分片、预制配置和余额解析测试；当前单元测试共 60 例。
- Playwright 共 20 例，其中真实 DeepSeek 套件增加官方余额接口校验，并验证 Messages → Chat
  的非流式、SSE 和 usage。

## 2026-08-04：MVP 可部署性、控制台与数据面增强

状态：已合入 `main`，已部署到 Cloudflare Worker `mygatewaydemo`。

### API 与管理能力

- `/v1/*` 使用 Hono 和 OpenAPI 路由，提供 `/v1/openapi.json` 与
  `/v1/api-docs`。
- 完成 Channels、Models、Gateway API Keys、System 和 Usage 管理闭环。
- 管理端从单一 Token 调整为简单管理员账号系统；首次账号为
  `admin / mygateway123`，登录后强制修改。
- `MASTER_KEY` 首次部署时随机生成且只显示一次，已有部署不会被覆盖。

### 控制台

- 控制台改为左侧导航、右侧内容的桌面布局，并统一浅色卡片、紫色强调色和
  响应式移动端样式。
- Dashboard 展示 Gateway Endpoint、渠道、模型、密钥、成功率、Fallback、
  Provider Token 用量和 usage 覆盖率。
- Token 未知请求单独显示，不再让未知用量看起来像真实的 0 Token。

### 部署与命名

- Worker 名称、部署文档和命令统一为 `mygatewaydemo`。
- 完成 GitHub → Cloudflare Workers Builds 自动部署验证。
- D1、Static Assets、migration 和 Secret 初始化流程同步到部署文档。
- 固定初始密码只用于首次登录；现有密码、Provider Key 和 `MASTER_KEY` 不会在
  普通重新部署时改变。

### 性能与免费档设计

- 冷请求通过一次 D1 `batch()` 完成 Gateway Key 鉴权和模型路由。
- 热请求使用有容量上限的 isolate TTL/LRU 缓存：Key 最多 1,000 条，路由最多
  200 条；缓存不使用 KV、Queues 或 Durable Objects。
- 响应增加稳定的 `X-Gateway-Timing`，并尽力写入标准 `Server-Timing`，包含
  缓存、D1、鉴权路由、上游首包和网关首包耗时。
- Workers Logs 使用 10% head sampling，并输出不含 Key、Prompt、Response 的
  结构化性能事件。

### 用量统计与 SSE

- “今日”统计改为按 `DEFAULT_TIMEZONE` 计算当地零点，默认
  `Asia/Shanghai`；7 天和 30 天仍为滚动范围。
- Token 只接受 Provider 返回的非负安全整数，不做本地分词估算。
- SSE decoder 支持任意网络分片、同 chunk 多事件、UTF-8 跨 chunk、多行
  `data:`、缺失尾空行和 `[DONE]`。
- usage 缺失、流中断、客户端取消或 JSON 损坏时记录 `usage_unknown`。
- 流完成、错误和取消共享幂等 finalizer，确保一次请求最多汇总一次。

### Fallback 与被动熔断

- 保留响应提交前的连接错误、超时、`408`、`429` 和 `5xx` Fallback。
- 渠道连续 3 次出现可回退故障后，在当前 isolate 冷却 30 秒。
- 冷却期间统一模型跳过故障渠道，并从后续优先级补足实际候选。
- 冷却结束后的下一次真实业务请求作为恢复探测；不产生主动 Provider 请求。
- 熔断状态最多保存 500 个渠道，随 isolate 回收自然丢失，不新增 D1/KV/DO
  成本。
- 更新渠道或连接测试成功时，立即清除当前 isolate 的相关熔断状态。

### 验证

- 41 个单元测试通过，包括 usage 时区、Token 校验、SSE fixtures、终态幂等、
  TTL/LRU、D1 batch 和被动熔断。
- 10 个无需真实 Provider Key 的 Playwright UI E2E 用例通过。
- TypeScript 检查、Dashboard 生产构建和 Worker dry-run 通过。
- 生产健康页、控制台资源和网关计时响应头完成 smoke test。

生产部署记录：

- Git 提交：`1b22eda`
- Worker 版本：`e9bf7091-33ec-4fc5-8f10-6e67d1d22c7c`
- 地址：<https://mygatewaydemo.leonguo08.workers.dev>

## 更新记录维护规则

- 只记录已经合入的变化，不把提案写成已实现能力。
- 每次发布列出用户影响、免费档成本变化、迁移/Secret 影响和验证结果。
- 涉及破坏性配置、数据库 migration 或 Secret 轮换时必须单独标注。
