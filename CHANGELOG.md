# MyGateway 更新日志

本文记录已经合入并部署的用户可见变化。架构设计见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，后续计划见
[docs/ROADMAP.md](docs/ROADMAP.md)。

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
- 10 个无外部依赖的 Playwright E2E 用例通过。
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
