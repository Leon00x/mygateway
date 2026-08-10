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
4. 通过预制弹窗添加 DeepSeek 渠道，验证保存前必须预检、失败降级保存、完成动效、自动余额
   查询、手工库存、勾选导入、批量摘要和竖向渠道卡片；
5. 创建统一模型和渠道实例；
6. 创建 Gateway Key，明文只展示一次；
7. 调用 `/v1/models` 和 Chat 接口，验证认证、错误和 timing Header；
8. 无 Gateway Key 返回 401；
9. Dashboard 显示渠道、模型和 Provider Balance；
10. 删除渠道显示关联影响，清理失去最后实例的统一模型，并保留仍有备用渠道的模型；
11. Analytics Usage 页面展示指标卡、模型表和筛选切换；
12. Analytics Logs 页面展示日志表、游标分页和详情抽屉，日志设置区在系统设置页；
13. 退出登录回到登录页。

该套件不需要有效 Provider Key，但 Chat 错误透传用例会用 dummy key 请求 DeepSeek 并期待
401，因此运行环境需要能够访问其 API。

## 5. 真实 DeepSeek 集成

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

## 6. SSE Fixture 要求

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

## 7. 发布前检查

```bash
npm test
npm run typecheck
npm run build
npx playwright test e2e/journey.spec.ts
npx playwright test e2e/realtime.spec.ts  # 有真实测试 Key 时
git diff --check
```

还应确认：

- migration 能在全新和已有本地数据库上增量执行；
- Dashboard 生产资源可加载；
- 日志、trace 和失败报告不含 Key、Prompt 或 Response；
- 生产 smoke test 只读取健康页和公开资源，除非明确授权使用生产凭据。

## 8. 尚未自动化的验证

- 1KB、100KB、1MB 非流式响应的 CPU 基线；
- 长 SSE 和慢客户端压力测试；
- 1、2、3 候选 Fallback 的 P95/P99；
- D1 `rows_read`、`rows_written` 和索引写放大基线；
- 接近 Cloudflare Free 10ms CPU 时的持续负载。

这些结果建立后应更新 [部署指南 Free Tier 容量规划](DEPLOY.md#7-free-tier-容量规划) 中的建议
使用范围，而不是把估算写成已验证事实。
