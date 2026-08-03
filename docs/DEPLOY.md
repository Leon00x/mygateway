# 一键部署到 Cloudflare 调研报告

> 调研日期：2026-08-03
> 目标：让用户点击一个按钮（或一条命令）就能把 MyGateway 部署到自己的 Cloudflare 账号，自动完成：D1 创建、migrations 执行、前端构建、Secrets 配置。

## 1. 结论摘要

| 能力 | 是否可行 | 方式 |
|---|---|---|
| Deploy Button（官方） | ✅ | `deploy.workers.cloudflare.com/?url=<GitHub repo>` |
| D1 自动创建 | ✅ | wrangler 自动 provision（已源码级验证） |
| Migrations 自动执行 | ✅ | Deploy 命令 `npm run deploy` 内包含 `wrangler d1 migrations apply DB --remote` |
| 前端自动构建 | ✅ | Deploy 命令内包含 `vite build` |
| Secrets 配置 | ⚠️ 手动 | Dash 上配 ADMIN_TOKEN / MASTER_KEY，或用 `--secrets-file` |
| 前提 | ⚠️ | **代码必须先推送到 GitHub**（Deploy Button 依赖 Git 集成） |

## 2. Deploy Button 机制（源码验证）

用户点击按钮 → `deploy.workers.cloudflare.com/?url=<repo>` → 重定向到
`dash.cloudflare.com/:account/workers-and-pages/create/deploy-to-workers` →
Cloudflare Dash 读取仓库的 `wrangler.jsonc`，走 **Workers Builds（Git 集成）** 流程：

1. **读取 wrangler 配置**，识别 D1 绑定、Secrets 等
2. **自动创建 Worker**（名字取 `wrangler.jsonc` 的 `name`）
3. **自动创建 D1** —— 已验证：
   - `config-schema.json` 中 `database_id` 描述为 *"The UUID of this D1 database (not required)"*
   - `wrangler deploy --dry-run` 只填 `database_name` 不报错，正常显示绑定
   - wrangler 源码 `provisionBindings()` → `collectPendingResources()` → `D1Handler`（`HANDLERS` 注册表包含 `d1`），缺 ID 时自动执行创建流程
4. **执行 Build 命令 + Deploy 命令**：
   - Deploy 命令默认 `npx wrangler deploy`，可自定义（官方文档确认）
   - 我们已在 `package.json` 配好 `"deploy": "npm run build:dashboard && npm run db:migrate:remote && wrangler deploy"`
5. **构建产物上传**：`wrangler deploy` 自动上传 `assets.directory`（`./dashboard/dist`）作为 Worker Static Assets

## 3. 需要改动的文件

### 3.1 `wrangler.jsonc` —— 移除 D1 占位符（关键！）

当前：
```jsonc
"d1_databases": [{
  "binding": "DB",
  "database_name": "mygateway-db",
  "database_id": "local-dev-placeholder"   // ← 必须移除
}]
```

改为：
```jsonc
"d1_databases": [{
  "binding": "DB",
  "database_name": "mygateway-db"
}]
```

原因：
- `local-dev-placeholder` 是本地开发时为了避免启动报错塞的假 ID
- 部署时若保留，wrangler 会用这个假 ID 找数据库 → 失败
- 移除后，`wrangler deploy` 自动 provision 真实 D1（首次部署时创建）

⚠️ **注意**：本地 `wrangler dev` 依赖 `.wrangler/state/v3/d1` 的本地 SQLite（与配置里的 ID 无关），移除占位符不影响本地开发。但 `wrangler dev` 启动时若 D1 无 ID 可能提示 `Couldn't find an auto-provisioned D1 DB named ...`（见 3.2）。

### 3.2 本地 dev 兼容

`wrangler dev` 在无 `database_id` 时会尝试 auto-provision（本地模拟），
报错信息：*"Run 'wrangler deploy' to provision it, or add 'database_name'/'database_id' to your config"*。
本地开发可用 `.dev.vars` 或环境配置覆盖，但**最简单方案**：保留本地用一个专门配置，或用 wrangler 的 `[env.local]` 段。

**推荐方案**：wrangler.jsonc 里用两个环境段：

```jsonc
{
  "name": "mygateway",
  "d1_databases": [{ "binding": "DB", "database_name": "mygateway-db" }],
  // 生产：database_id 留空，部署时自动创建
  "env": {
    "local": {
      "d1_databases": [{ "binding": "DB", "database_name": "mygateway-db", "database_id": "local-dev-placeholder" }]
    }
  }
}
```

本地 `wrangler dev -e local`，生产 `wrangler deploy`（无 env）。

### 3.3 `package.json` deploy 脚本（已就绪）

```json
"deploy": "npm run build:dashboard && npm run db:migrate:remote && wrangler deploy"
```

问题：`wrangler d1 migrations apply DB --remote` 在 D1 刚 auto-provision 后执行是否成功？
- **需要实测**。若 migrations apply 早于 D1 provision 完成，会报数据库不存在。
- 备选：Deploy 命令只跑 `wrangler deploy`（D1 自动创建），migrations 由用户 Dash 上手动跑一次，或后续 build 触发。

### 3.4 Secrets —— ADMIN_TOKEN / MASTER_KEY

Deploy Button 流程中，Cloudflare Dash 的 **"Variables and Secrets"** 页让用户添加：

| Secret | 用途 | 生成方式 |
|---|---|---|
| `ADMIN_TOKEN` | 管理后台登录 | 用户自设（≥32 字节随机） |
| `MASTER_KEY` | Provider Key 加密（AES-GCM） | 用户自设（≥32 字节，建议 base64） |

两种配置路径：
1. **Dash 手动**（Deploy Button 场景）：部署完成后到 Worker → Settings → Variables and Secrets 添加
2. **wrangler CLI**（本地一键脚本）：`wrangler secret put ADMIN_TOKEN` / `wrangler secret put MASTER_KEY`，或 `wrangler deploy --secrets-file secrets.json`

**`--secrets-file` 验证**：官方文档确认 `wrangler deploy --secrets-file <file>` 支持 JSON / .env 格式，CI/CD 常用。但 Deploy Button 的 Builds 环境里 secrets 文件不能入库（含明文密钥），所以：
- 本地手动部署：`wrangler secret bulk < secrets.json`（交互式，不落盘）
- Deploy Button：Dash 手动配置

### 3.5 Dashboard 里已有对部署的依赖

`src/env.ts` 的 `parseConfig` 会校验 `ADMIN_TOKEN`、`MASTER_KEY`，缺失时返回配置错误（`/health` 正常但 API 报错）。所以 Secrets 必须在首次调用前配好。

## 4. 推荐交付物

### 方案 A：Deploy Button（推荐，符合 PRD）

1. 代码推送到 GitHub 公共仓库
2. `wrangler.jsonc` 按 3.1/3.2 调整
3. README 增加：
   ```md
   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=<REPO_URL>)
   ```
4. 部署后 Dash 配 2 个 Secrets

**风险点**：
- Deploy Button 的 `npm run deploy`（含 migration）时序需实测
- 仓库需要公开（或 Deploy Button 支持私有？待确认）
- Workers Builds 的构建环境是否有 `npm install`？默认有（官方文档说用 package.json 的 wrangler 版本）

### 方案 B：本地一键部署脚本（最快落地）

不依赖 GitHub。写一个 `scripts/deploy.sh`（或 node 脚本）：

```bash
#!/bin/bash
# 1. 构建前端
npm run build:dashboard
# 2. 创建 D1（如果不存在）
npx wrangler d1 create mygateway-db
# 3. 写 database_id 回 wrangler.jsonc（或提示手动）
# 4. 配置 Secrets（交互式）
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put MASTER_KEY
# 5. 迁移
npx wrangler d1 migrations apply DB --remote
# 6. 部署
npx wrangler deploy
```

**优点**：立即可用、交互式安全、不依赖 repo 公开
**缺点**：不是"一键按钮"，需要本机有 wrangler + Cloudflare 登录（`wrangler login`）

### 建议：两者都做
- **方案 B 先落地**（用户当前无远程 Git 仓库，立即能验证部署闭环）
- **方案 A 后补**（等代码上 GitHub，补按钮）

## 5. 下一步行动

1. [ ] 修改 `wrangler.jsonc`：移除 `database_id` 占位符 + 加 `env.local`
2. [ ] 写 `scripts/deploy.sh`（方案 B）
3. [ ] 实测 `wrangler deploy` 首次部署（D1 auto-provision + migration 时序）
4. [ ] 实测 Secrets 配置后 `/health` + 登录 + 网关调用
5. [ ] （可选）推 GitHub + Deploy Button
