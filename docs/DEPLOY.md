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
2. 自动创建 Worker（名称取 `wrangler.jsonc` 的 `name`）
3. 自动创建 D1 —— `database_id` 可选，缺失时 wrangler 自动 provision
4. 执行 Deploy 命令（默认 `npx wrangler deploy`，可自定义）
5. `wrangler deploy` 自动上传 `assets.directory`（`./dashboard/dist`）作为 Static Assets

### 2.2 关键设计

- 生产 `wrangler.jsonc` 的 D1 **不填 `database_id`** → 首次部署自动创建；若要固化，`wrangler d1 list` 拿 ID 回填
- Deploy 脚本顺序：`build:dashboard → wrangler deploy（触发 D1 provision）→ db:migrate:remote（建表）`
- Secrets（ADMIN_TOKEN / MASTER_KEY）由用户部署后在 Dash 手动配置，Deploy Button 不自动提示
- `.dev.vars.example` 只提供字段名模板，真实值永不入库

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
| Git 存储库 | 你 fork/克隆后的仓库（注意：**必须是真实仓库名**，不是 Worker 名） |
| 生产分支 | `main` |
| 构建命令 | `npm ci && npm run build:dashboard` |
| 部署命令 | `npx wrangler deploy && npm run db:migrate:remote` |

## 4. 已踩过的坑（务必避免）

1. **Git 存储库选错**：把 Worker 名（如 `xxx/mygatewaydemo`）当仓库名选进去 → 连到不存在的仓库，构建永不触发。**仓库名必须与 GitHub 上真实一致**。
2. **Worker 名称不匹配**：Dash 上 Worker 名必须与 `wrangler.jsonc` 的 `name` 一致，否则 Builds 构建失败（试图创建新 Worker）。
3. **构建/部署命令错误**：`npm run build`（会 dry-run deploy）不是纯构建；`npx wrangler deploy` 不构建前端。正确组合见上表。
4. **D1 权限缺失**：API Token 若缺 D1: Edit 权限，部署报 `Authentication error`。创建 Token 选 "Edit Cloudflare Workers" 模板并**手动加 D1: Edit**。
5. **database_id 硬编码**：不要把某个账号的 D1 ID 提交到仓库（未来用户会用别人的库）。

## 5. 诊断命令

```bash
# 查看部署历史（确认是否 Git 触发）
npx wrangler deployments list --name <worker>

# 查看 D1
npx wrangler d1 list

# 手动部署（跳过构建）——已配置好环境变量时
npm run deploy
```
