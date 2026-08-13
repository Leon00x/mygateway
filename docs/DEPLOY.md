# MyGateway 部署指南

[English](DEPLOY.en.md) · [简体中文](DEPLOY.md)

本文只说明部署、升级、回滚和排障。产品介绍见 [README](../README.md)，
系统结构见[架构文档](ARCHITECTURE.md)，验证方法见[测试指南](TESTING.md)。

目标是让用户以尽量少的步骤把 MyGateway 部署到自己的 Cloudflare 账号，并通过
Workers Builds 持续更新。

## 1. 部署方式总览

| 方式 | 是否推荐 | 说明 |
|---|---|---|
| Deploy Button | ✅ 推荐 | 浏览器完成，零本地操作 |
| 本地命令行 | ✅ 可选 | 需要 `wrangler login` |
| 自动部署（Workers Builds） | ✅ 推荐 | push 即自动重新部署 |

## 2. 机制要点

### 2.1 Deploy Button 做了什么

`deploy.workers.cloudflare.com/?url=<repo>` → Cloudflare Dash 读取仓库 `wrangler.jsonc`：

1. 读取 Wrangler 配置（识别 Worker / D1 / Assets 绑定）
2. 按 `wrangler.jsonc` 中的 `name` 创建或更新 Worker；Fork 后可在部署前改成自己的名称
3. 自动创建 D1 —— `database_id` 可选，缺失时 wrangler 自动 provision
4. 执行 Deploy 命令（默认 `npx wrangler deploy`，可自定义）
5. `wrangler deploy` 自动上传 `assets.directory`（`./dashboard/dist`）作为 Static Assets

### 2.2 关键设计

- 生产 `wrangler.jsonc` 的 D1 **不填 `database_id`** → 首次部署自动创建；若要固化，`wrangler d1 list` 拿 ID 回填
- 升级时的 Deploy 脚本顺序：`build:dashboard → db:migrate:remote → wrangler deploy → secrets:init`。必须先让 D1 具备新代码需要的兼容结构，再切换 Worker
- `secrets:init` 通过当前 Wrangler 配置定位 Worker，仅在 Secret 不存在时设置
  `INITIAL_ADMIN_PASSWORD` 与 `MASTER_KEY`，已有值永不覆盖；Fork 后修改 Worker 名也无需改脚本
- 管理员初始密码固定为 `mygateway123`；Master Key 随机生成且只在部署日志显示一次，用户必须立即保存
- `.dev.vars.example` 提供公开的固定初始密码；真实 `MASTER_KEY` 永不入库
- `wrangler.jsonc` 启用 Workers Logs，并使用 10% head sampling；性能响应头不依赖额外服务
- 渠道被动熔断只使用 isolate 内存（3 次故障、冷却 30 秒），不需要新增 Cloudflare Binding

首次部署输出示例：

```text
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=mygateway123
MASTER_KEY=<base64 备份值>
```

使用初始账号登录后，控制台会强制进入凭据修改页。修改完成后密码摘要保存到 D1，`INITIAL_ADMIN_PASSWORD` 不再参与正常登录。旧版部署若尚未初始化管理员表，可使用原 `ADMIN_TOKEN` 作为一次性初始密码迁移。

生产排障时优先在响应的 `X-Gateway-Timing` 查看缓存命中、D1、上游首包和网关首包耗时；标准 `Server-Timing` 也会写入，但可能被 Cloudflare 的平台指标覆盖。Cloudflare 日志只保留抽样的脱敏结构化事件，不应依赖它做精确请求计数。

## 3. 自动部署（Workers Builds）

连接 Git 仓库后，push 到生产分支自动触发构建+部署：

```
push 代码 → GitHub → Cloudflare Workers Builds
  → npm ci → 构建前端（dashboard/dist）
  → wrangler d1 migrations apply DB --remote（增量建表）
  → wrangler deploy（上传 Worker + Static Assets）
  → 生产更新
```

**Builds 页面配置**：

| 字段 | 值 |
|---|---|
| Git 存储库 | 你 Fork 后的真实仓库；使用上游仓库时为 `Leon00x/mygateway`（不是 Worker 名） |
| 生产分支 | `main` |
| 构建命令 | `npm ci && npm run build:dashboard` |
| 部署命令 | `npm run deploy` |

> 不要保留 Workers Builds 默认的 `npx wrangler deploy`。默认命令只发布 Worker，
> 不会执行仓库中的 D1 migration；需要在 Cloudflare Dashboard 的 Settings → Builds
> 中将部署命令设为 `npm run deploy`。实际步骤统一维护在 `package.json`，Wrangler
> 配置里的 Custom Builds 当前也不能代替这项设置。

## 4. 升级与回滚

### 4.1 日常升级

合并或推送到生产分支 `main` 后，Workers Builds 会依次构建 Dashboard、增量执行
D1 migration、部署 Worker 与 Static Assets，并检查首次 Secret：

```text
main 更新 → Workers Builds → D1 migration → Worker / Assets → Secret 检查
```

- migration 必须保持向后兼容，已经执行的 migration 不会重复执行。若 migration 失败，部署命令会停止，新 Worker 不会上线。
- 普通升级不会重置管理员密码，也不会轮换 `MASTER_KEY` 或 Provider Key。
- 升级前应确认已安全备份首次部署日志中的 `MASTER_KEY`。
- 生产变更完成后按[测试指南](TESTING.md)执行最小发布检查。

### 4.2 回滚边界

Cloudflare Dashboard 或 Wrangler 可以回滚 Worker 代码和 Static Assets，但不会自动
撤销已经执行的 D1 migration。因此数据库变更应优先采用新增字段、兼容读取和分阶段
迁移；需要回退数据库时，应编写新的修复 migration，而不是直接删除生产数据。

## 5. 常见问题

1. **Git 存储库选错**：把 Worker 名当成仓库名 → 连到不存在的仓库，构建永不触发。**仓库名必须与 GitHub 上真实一致**。
2. **Worker 名称不匹配**：手工导入仓库时，确认 Dash 中目标 Worker 与当前 `wrangler.jsonc`
   的 `name` 一致；Deploy Button 创建的 Fork 会把用户选择反映到生成配置中。
3. **构建/部署命令错误**：`npm run build`（会 dry-run deploy）不是纯构建；Workers Builds 默认的 `npx wrangler deploy` 也不会执行 migration。部署阶段必须按“migration → deploy → Secret 检查”的顺序执行，正确组合见上表。
4. **D1 权限缺失**：API Token 若缺 D1: Edit 权限，部署报 `Authentication error`。创建 Token 选 "Edit Cloudflare Workers" 模板并**手动加 D1: Edit**。
5. **database_id 硬编码**：不要把某个账号的 D1 ID 提交到仓库（未来用户会用别人的库）。
6. **重复生成 MASTER_KEY**：`secrets:init` 会检查 Secret 名称并复用已有值；不要手工删除或覆盖生产 `MASTER_KEY`。

## 6. 诊断命令

```bash
# 查看部署历史（确认是否 Git 触发）
npx wrangler deployments list

# 查看 D1
npx wrangler d1 list

# 确认生产库没有待执行 migration
npx wrangler d1 migrations list DB --remote

# 查看实时日志
npx wrangler tail

# 手动部署——已配置好环境变量时
npm run deploy
```

部署后至少确认：目标 Worker 名称正确、管理控制台可打开、D1 migration
已完成，并对健康页或一个已配置的模型完成 smoke test。不要在日志或工单中粘贴
`MASTER_KEY`、Gateway Key、Provider Key、Prompt 或完整响应。

## 7. Free Tier 容量规划

默认部署只使用：

```text
1 个 Worker（包含 Static Assets）
1 个 D1 数据库
2 个首次部署 Secrets
1 个每日 Cron Trigger
```

与本项目最相关的官方 Free 限制（2026-08-13 核对；额度可能变化，部署前应查看
[Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)、
[D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) 和
[D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)）：

| 项目 | Free 限制 | MyGateway 的控制方式 |
|---|---:|---|
| Worker 请求 | 100,000/天 | 管理请求、模型调用和静态资源请求都可能计入，应以账号指标为准 |
| Worker CPU | 10ms/请求 | 流式转发、有限解析，不缓存完整响应 |
| 外部子请求 | 50/请求 | 最多尝试 3 个 Provider，候选串行而非广播 |
| 并发出站连接 | 6/请求 | 单请求顺序尝试渠道 |
| D1 读取 | 5,000,000 行/天 | 索引、一次 batch、短 TTL isolate 缓存 |
| D1 写入 | 100,000 行/天 | 每个完成请求更新 Analytics、密钥用量和可选日志；索引也会增加写入行数 |
| D1 存储 | 500MB/数据库、账号总计 5GB | 一个数据库，分钟聚合 30 天、请求日志 1–7 天（控制台可调）、密钥用量 30 天 |
| Workers Logs | 200,000 事件/天、保留 3 天 | 10% head sampling 和脱敏事件 |

降低额度的关键做法：

- 热请求使用有容量上限的 isolate 内存缓存，缓存命中时不查询 D1；冷请求一次 `batch()`
  完成鉴权与路由；
- 用量、密钥用量和请求日志在同一 `waitUntil()` 内通过一次 `batch()` 提交，失败不阻断
  模型响应；
- 密钥未配置每日预算时跳过配额 D1 读取；每日 Cron 只清理过期统计，不执行余额、模型同步
  或健康探测；
- 熔断和 RPM 窗口保存在 isolate 内存，不使用 KV、DO 或额外数据库写入。

边界与超额行为：D1 达到每日读写额度后配置路由可能返回 503；usage 写入或看板查询失败
不会中断已完成的模型响应；Workers 达到每日请求或 CPU 限制后由 Cloudflare 拒绝请求。
如果代表性负载持续接近额度，应降低统计/日志开销或升级 Workers Paid，不能静默牺牲
安全校验和流式正确性。
