# MyGateway 测试指南

本文说明测试层次、环境准备、运行方法和当前覆盖。测试代码是具体用例行为的权威来源。

## 1. 测试层次

| 层次 | 命令 | 目的 |
|---|---|---|
| 单元测试 | `npm test` | 纯逻辑、边界条件和协议 fixtures |
| 类型检查 | `npm run typecheck` | Worker 与 Dashboard 严格 TypeScript 类型 |
| 前端构建 | `npm run build:dashboard` | SolidJS 生产构建 |
| Worker dry-run | `npm run build` | 前端构建和 Wrangler 打包 |
| UI E2E | `npx playwright test e2e/journey.spec.ts` | 浏览器管理闭环和 Gateway HTTP |
| Admin API E2E | `npx playwright test e2e/admin-api.spec.ts` | 渠道、库存、模型、实例和调用错误矩阵 |
| Management API E2E | `npx playwright test e2e/management-api.spec.ts` | Agent 权限、生命周期、资源管理与凭据不泄漏 |
| Management UI E2E | `npx playwright test e2e/management-ui.spec.ts` | 管理密钥创建、1 小时恢复与删除 |
| 可控上游 E2E | `npm run test:e2e:upstream` | 真实 Worker 路由、Fallback、流中断与取消传播 |
| 真实集成 | `npx playwright test e2e/realtime.spec.ts` | 使用真实 DeepSeek Key 验证上游协议 |

## 2. 单元测试

单元测试按领域拆分如下；准确用例数以 `npm test` 输出为准：

| 文件 | 覆盖重点 |
|---|---|
| `access-resolver.test.ts` | Key 与模型冷请求 batch、缓存状态 |
| `balance-refresh-repro.test.ts` | 强制刷新、五分钟缓存和概览回读 |
| `deepseek-balance.test.ts` | 官方 host、金额精度、鉴权和错误清理 |
| `key-quota.test.ts` | 密钥到期、RPM 窗口、每日预算台账与成本计算 |
| `log-policy.test.ts` | 日志总开关、级别策略、合并 batch、TTFT 与上下文写入矩阵 |
| `fallback-policy.test.ts` | HTTP / Provider 错误分类 |
| `model-discovery.test.ts` | OpenAI / Gemini / Anthropic 模型列表、分页和 ID 规范化 |
| `passive-circuit-breaker.test.ts` | 阈值、冷却、恢复和容量 |
| `password.test.ts` | 密码规则、摘要和验证 |
| `protocol-conversion.test.ts` | Chat / Messages 请求与非流式响应 |
| `protocol-routing.test.ts` | 原生优先、转换候选和协议不匹配 |
| `protocol-stream.test.ts` | Chat / Messages SSE 转换 |
| `provider-localization.test.ts` | 中英文预置名、历史默认名兼容和自定义渠道名保留 |
| `provider-presets.test.ts` | 预制唯一性、端点和协议能力 |
| `provider-balance-ui.test.ts` | 跨 isolate `not_queried` 不覆盖浏览器刷新结果 |
| `server-timing.test.ts` | 稳定计时响应头 |
| `sse-decoder.test.ts` | 任意分片、UTF-8、多事件和 usage |
| `ttl-lru.test.ts` | TTL、LRU 和容量淘汰 |
| `usage.test.ts` | 时区、统计范围、Token 校验和终态幂等 |
| `analytics.test.ts` | 5 分钟桶、上下文 AES-GCM 与 4 KiB 截断、三协议 SSE 有效内容检测 |

运行：

```bash
npm test
npm run typecheck
```

单元测试不得依赖真实 Provider、生产 D1 或 Cloudflare 账号。

## 3. E2E 环境

安装浏览器：

```bash
npx playwright install chromium
```

准备 `.dev.vars`：

```text
INITIAL_ADMIN_PASSWORD=<本地首次密码>
MASTER_KEY=<32 字节随机值的 base64>
DEEPSEEK_TEST_KEY=<可选，真实集成使用>
```

构建前端、初始化本地 D1 并启动测试服务器：

```bash
npm run build:dashboard
npm run db:migrate:local
npx wrangler dev --port 8799
```

另一个终端运行：

```bash
npm run test:e2e
```

如果使用其他端口：

```bash
E2E_BASE_URL=http://127.0.0.1:8800 npm run test:e2e
```

E2E 会创建、修改和删除渠道、模型与 Gateway Key。不要指向包含需要保留数据的数据库；
开发时推荐使用独立的 Wrangler `--persist-to` 目录。

## 4. UI 旅程

`e2e/journey.spec.ts` 当前 13 个串行用例：

1. 未登录访问跳转登录页；
2. 错误管理员凭据显示错误；
3. 正确登录，并验证侧边栏收缩、暗黑模式和主题持久化；
4. 通过预制弹窗添加 DeepSeek 渠道，验证三协议 path/Base URL 编辑器、保存前必须预检、失败
   降级保存、完成动效、自动余额查询、手工库存、勾选导入、批量摘要和竖向渠道卡片；并通过
   Admin API 验证相同供应商 + Provider Key 再次创建返回 `409 resource_in_use` 且不会重复导入；
5. 通过模态表单创建统一模型和渠道实例，并验证同一模型重复绑定相同渠道返回 409；
6. 创建带精确到期时间的 Gateway Key，验证明文只展示一次，并拒绝创建已过期密钥；
7. 调用 `/v1/models` 和 Chat 接口，验证认证、错误和 timing Header；
8. 无 Gateway Key 返回 401；
9. Dashboard 显示渠道、首个已创建模型和 Provider Balance；创建服务端标记的 1 小时临时
   密钥，验证固定到期时间、不可续期 / 重新生成、刷新后从 `localStorage` 恢复，并在本地到期
   后自动清除；单元测试同时约束列表隐藏与创建 / 删除时的惰性清理 SQL；
10. 删除渠道显示关联影响，清理失去最后实例的统一模型，并保留仍有备用渠道的模型；
11. Analytics Usage 页面展示指标卡、模型表和筛选切换；
12. Analytics Logs 页面展示日志表、游标分页和详情抽屉；日志策略与清空日志仅在系统设置页；
13. 退出登录回到登录页。

该套件不需要有效 Provider Key，但 Chat 错误透传用例会用 dummy key 请求 DeepSeek 并期待
401，因此运行环境需要能够访问其 API。

## 5. Admin API 与调用边界

`e2e/admin-api.spec.ts` 不使用真实 Provider Key，当前 5 组串行用例：

1. 创建自定义三协议渠道，验证空协议、重复协议、非 HTTPS 地址、重复 Provider Key；保存名称、
   协议 Base URL 和启停状态，并验证编辑阶段的重复 Key 冲突；
2. 手工渠道模型库存的添加、重复添加幂等、列表、删除与非法参数；
3. 统一模型创建、重复 ID、渠道实例添加、同渠道重复实例、Alias 冲突、实例定价、币种校验、
   负价格、回退顺序、模型编辑、删除后使用相同 ID 重建；
4. 从库存导入模型、重复导入幂等、库存缺失和超过 100 个模型的批量限制；
5. Gateway HTTP 验证模型白名单、停用 Key、未知模型、协议不可用及渠道停用后的模型不可用。

该套件只使用本地 D1 和不会实际访问的 Provider 地址，适合常规 CI。它不替代下述可控上游与
真实 Provider 测试。

## 6. Management API 与 Skill

`e2e/management-api.spec.ts` 使用真实 Worker HTTP 和本地 D1，覆盖 Skill 中声明的只读查询与
资源写操作、公开能力发现与双规范 API 文档、无凭据拒绝、`read` / `write` 权限、渠道与模型实例创建、Gateway Key
一次性明文、余额/用量/日志查询，以及
Management Key 的到期、停用和删除。测试显式断言 Provider Key、hash 和 ciphertext 不会
出现在响应中。

同一旅程还覆盖 Overview 初始化状态机：空网关为 `needs_channel`，仅有渠道为 `needs_model`，形成
活动模型链路后为 `needs_gateway_key`，创建客户端 Key 后为 `ready`；每一步都断言 Overview 不包含
Provider Key 或一次性 Gateway Key。Skill 静态断言覆盖首次体检、资源用途、渠道/价格边界和空网关
引导语义，并覆盖渠道/库存/统一模型关系、自动发现操作边界、非文本产品不受数据面支持、最小 API
选择、`active` 非健康结论、Provider Presets 复用，以及 manifest 的 `SKILL.md` / `download_url`
更新约定。Provider 单元测试覆盖官方 Host 的唯一身份识别和未知 Host 保持自定义。

`e2e/management-ui.spec.ts` 验证 System 页自动检测网站访问地址、拒绝非 Origin 输入，并将保存后
的规范地址同步到首页端点与 Agent 提示词；提示词只包含 Skill 安装入口，manifest 版本检查规则
由托管 `skill.md` 提供。同时验证默认展示安全占位符，创建后配置提示词包含一次性 Key，刷新仍可
从同源 `localStorage` 恢复，并在 1 小时窗口失效或删除后恢复占位模板。
API E2E 同时确认 `/skills/index.json`、`/skill.md` 和 `/skill.json` 可由部署网站直接读取，断言
入口文件不依赖本地 helper，并检查 Skill 明确要求安全持久化与后续加载 Management Key。公开文档
测试还验证 `/v1/api-docs` 包含两份规范、`/management/v1/api-docs` 无需鉴权，以及 OpenAPI 的
写入凭据标记、查询参数和权限声明。Skill 可做无凭据发现 smoke test：

```bash
curl http://localhost:8799/skill.md
curl http://localhost:8799/management/v1/capabilities
curl http://localhost:8799/management/v1/api-docs
curl -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY" \
  http://localhost:8799/management/v1/overview
python3 /home/leon/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/mygateway-admin
```

## 7. 可控上游集成

`e2e/controlled-upstream.spec.ts` 会由 Playwright 进程在随机 loopback 端口启动本地假 Provider，
不读取或发送真实 Provider Key。请求仍经过正在运行的 Worker、D1 路由和真实 HTTP fetch，当前覆盖：

1. 上游 `503`、`429` 和连接断开后按优先级切换到备用渠道；
2. 上游 `401` 属于不可重试错误，不错误切换渠道；
3. Provider 鉴权头使用解密后的渠道 Key，请求模型被替换为渠道模型 ID；
4. 响应已提交后流式上游中断，不跨渠道续接内容；
5. 客户端取消流式响应时，取消传播至当前上游连接；
6. 上游响应头超时后切换备用渠道（使用短超时测试模式）。

常规运行会执行除超时外的用例：

```bash
npm run test:e2e:upstream
```

超时用例需要 Worker 与测试使用相同的短超时值。先停止普通开发服务器，然后启动：

```bash
npx wrangler dev --port 8799 --var UPSTREAM_HEADER_TIMEOUT_MS:300
```

另一个终端运行：

```bash
E2E_UPSTREAM_TIMEOUT_MS=300 npm run test:e2e:upstream
```

这里的短超时只用于测试，不应照搬到生产配置。假 Provider 对慢请求最长等待 5 秒，避免使用默认
30 秒超时拖慢常规测试。

## 8. 真实 DeepSeek 集成

`e2e/realtime.spec.ts` 在缺少 `DEEPSEEK_TEST_KEY` 时整套跳过。当前 10 个串行用例：

1. 在页面用真实 Key 预检 V4 模型，确认预检不创建渠道，取消一个模型后只导入勾选项；
2. 渠道连接测试；
3. 查询官方账户余额并校验金额字符串；
4. 通过官方模型列表发现 V4 模型，并导入为可调用的网关模型；
5. 创建 Gateway Key；
6. 非流式 Chat completion 和 usage；
7. 流式 Chat、`[DONE]` 和 usage chunk；
8. DeepSeek 原生 Messages 非流式请求；
9. DeepSeek 原生 Messages 流式事件；
10. 管理端用量汇总。

这些测试会产生少量真实模型调用和 Provider 费用。Key 只能从环境读取，不得硬编码、写入
日志或测试报告。

单独运行：

```bash
npx playwright test e2e/realtime.spec.ts
```

## 9. SSE Fixture 要求

协议或流式逻辑变化时至少覆盖：

- 一个 SSE event 跨多个网络 chunk；
- 一个 chunk 包含多个 event；
- 中文 UTF-8 跨 chunk；
- 多行 `data:`；
- 正常 usage 和 `[DONE]`；
- usage 缺失、JSON 损坏和上游中断；
- 客户端取消；
- finalizer 最多写入一次；
- 工具参数跨多个增量事件。

## 10. 发布前检查

```bash
npm test
npm run typecheck
npm run build
npx playwright test e2e/journey.spec.ts
npx playwright test e2e/admin-api.spec.ts
npx playwright test e2e/management-api.spec.ts e2e/management-ui.spec.ts
npm run test:e2e:upstream
npx playwright test e2e/realtime.spec.ts  # 有真实测试 Key 时
git diff --check
```

还应确认：

- migration 能在全新和已有本地数据库上增量执行；
- 价格基线 migration 在全新数据库中得到 30 条记录，且不会覆盖管理员已修改的旧价格；
- Dashboard 生产资源可加载；
- 日志、trace 和失败报告不含 Key、Prompt 或 Response；
- 生产 smoke test 只读取健康页和公开资源，除非明确授权使用生产凭据。

## 11. 尚未自动化的验证

- 1KB、100KB、1MB 非流式响应的 CPU 基线；
- 长 SSE 和慢客户端压力测试；
- 1、2、3 候选 Fallback 的 P95/P99；
- D1 `rows_read`、`rows_written` 和索引写放大基线；
- 接近 Cloudflare Free 10ms CPU 时的持续负载。

这些结果建立后应更新 [部署指南 Free Tier 容量规划](DEPLOY.md#7-free-tier-容量规划) 中的建议
使用范围，而不是把估算写成已验证事实。
