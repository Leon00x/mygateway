# 参与 MyGateway 开发

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

感谢你关注 MyGateway。项目刻意保持轻量：优先适配 Cloudflare 免费额度，使用 D1 与 isolate 内存，并把“容易部署、容易理解”放在企业级功能数量之前。

## 项目原则

- **免费额度优先**：除非产品规划明确批准，不引入自托管服务、KV、R2、Queues 或 Durable Objects。
- **简单且可预期**：采用固定优先级路由、响应前 Fallback，不进行隐藏的后台探测。
- **易于使用**：一套调用密钥和一个控制台，默认配置可以直接工作；对话上下文默认不保存。
- **数据口径诚实**：Token 和费用来自供应商上报；缺失时标记未知，不在网关内猜测。

## 环境准备

```bash
npm run local            # 安装、初始化、构建、迁移并在 http://localhost:8787 启动
```

首次运行使用 [README](../README.zh-CN.md) 中的初始管理员凭据，登录后应立即修改。

完成首次初始化后，追求更快的手工开发循环时可以分别执行 `npm run build:dashboard`、
`npm run dev:setup` 和 `npm run dev`；单命令入口复用的也是这些项目脚本。

## 开发与验证

```bash
npm run test:fast          # 文档、类型、单测、Dashboard 和 Worker dry-run
npm run test:e2e:serve     # 在另一个终端启动本地 D1 与 Worker
npm run test:api           # Admin 与 Management HTTP 契约
npm run test:ui            # 浏览器用户旅程
npm run test:system        # 可控上游路由与流式行为
npm run test:sit           # 显式运行真实集成，会产生 Provider 用量
```

提交 Pull Request 前确认：

1. `npm run test:fast` 通过。
2. 按测试活动矩阵运行所有受影响层，并为新增行为补充测试。
3. 发布维护者运行 `npm run test:release`；没有 SIT 凭据的贡献者运行 `test:release:local`。
4. Schema 变更使用 `migrations/` 中新的连续编号 migration。
5. 用户可见行为同步到 `docs/PRD.md`；实现细节只写入对应架构或设计文档，不在多个文件复制同一段内容。

## 目录说明

| 路径 | 用途 |
|---|---|
| `src/gateway/` | `/v1/*` 数据面：鉴权、路由、Fallback、配额和缓存 |
| `src/admin/` | `/admin/api/*` 管理控制面 |
| `src/db/` | D1 查询与写入 |
| `migrations/` | 按顺序执行的 D1 Schema migrations |
| `dashboard/` | SolidJS 管理控制台 |
| `test/` | Vitest 单元测试 |
| `e2e/` | Playwright UI、API、可控上游与真实供应商测试 |

## 提交约定

提交信息使用约定式前缀，例如 `feat:`、`fix:`、`docs:` 和 `refactor:`。新增或调整测试后，应同步维护 `docs/TESTING.md`。

## 获取帮助

问题和功能建议请提交 Issue。实现前先讨论取舍；破坏免费额度或“容易运行”原则的功能可能不会进入核心版本。
