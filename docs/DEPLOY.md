# 部署指南：MyGateway 到 Cloudflare

> 目标：让新用户以最少步骤部署 MyGateway 到自己 Cloudflare 账号，并建立自动部署。
> 面向所有用户的部署步骤见 [README §0](../README.md)。本文记录机制与踩坑。

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
2. 创建或更新 Worker（名称为 `wrangler.jsonc` 中的 `mygatewaydemo`）
3. 自动创建 D1 —— `database_id` 可选，缺失时 wrangler 自动 provision
4. 执行 Deploy 命令（默认 `npx wrangler deploy`，可自定义）
5. `wrangler deploy` 自动上传 `assets.directory`（`./dashboard/dist`）作为 Static Assets

### 2.2 关键设计

- 生产 `wrangler.jsonc` 的 D1 **不填 `database_id`** → 首次部署自动创建；若要固化，`wrangler d1 list` 拿 ID 回填
- Deploy 脚本顺序：`build:dashboard → wrangler deploy → db:migrate:remote → secrets:init`
- `secrets:init` 仅在 Secret 不存在时生成 `INITIAL_ADMIN_PASSWORD` 与 `MASTER_KEY`，已有值永不覆盖
- 首次生成的管理员密码和 Master Key 只在部署日志显示一次，用户必须立即保存
- `.dev.vars.example` 只提供字段名模板，真实值永不入库

首次部署输出示例：

```text
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=<随机一次性密码>
MASTER_KEY=<base64 备份值>
```

使用初始账号登录后，控制台会强制进入凭据修改页。修改完成后密码摘要保存到 D1，`INITIAL_ADMIN_PASSWORD` 不再参与正常登录。旧版部署若尚未初始化管理员表，可使用原 `ADMIN_TOKEN` 作为一次性初始密码迁移。

## 3. 自动部署（Workers Builds）

连接 Git 仓库后，push 到生产分支自动触发构建+部署：

```
push 代码 → GitHub → Cloudflare Workers Builds
  → npm ci → 构建前端（dashboard/dist）
  → wrangler deploy（上传 Worker + Static Assets）
  → wrangler d1 migrations apply DB --remote（增量建表）
  → 生产更新
```

**Builds 页面配置**：

| 字段 | 值 |
|---|---|
| Git 存储库 | `Leon00x/mygateway`（或你 fork 后的真实仓库名，不是 Worker 名） |
| 生产分支 | `main` |
| 构建命令 | `npm ci && npm run build:dashboard` |
| 部署命令 | `npx wrangler deploy && npm run db:migrate:remote && npm run secrets:init` |

## 4. 已踩过的坑（务必避免）

1. **Git 存储库选错**：把 Worker 名 `mygatewaydemo` 当成仓库名 → 连到不存在的仓库，构建永不触发。**仓库名必须与 GitHub 上真实一致**。
2. **Worker 名称不匹配**：Dash 上 Worker 名和 `wrangler.jsonc` 的 `name` 都必须是 `mygatewaydemo`，否则 Builds 可能尝试创建另一个 Worker。
3. **构建/部署命令错误**：`npm run build`（会 dry-run deploy）不是纯构建；部署阶段还必须执行 Secret 初始化和 migration，正确组合见上表。
4. **D1 权限缺失**：API Token 若缺 D1: Edit 权限，部署报 `Authentication error`。创建 Token 选 "Edit Cloudflare Workers" 模板并**手动加 D1: Edit**。
5. **database_id 硬编码**：不要把某个账号的 D1 ID 提交到仓库（未来用户会用别人的库）。
6. **重复生成 MASTER_KEY**：`secrets:init` 会检查 Secret 名称并复用已有值；不要手工删除或覆盖生产 `MASTER_KEY`。

## 5. 诊断命令

```bash
# 查看部署历史（确认是否 Git 触发）
npx wrangler deployments list --name mygatewaydemo

# 查看 D1
npx wrangler d1 list

# 手动部署（跳过构建）——已配置好环境变量时
npm run deploy
```
