# MyGateway

部署在自有 Cloudflare 账号中的轻量 AI API 网关：一份 Key 统一接入多家模型供应商，
对外提供 OpenAI Chat / Responses 与 Anthropic Messages 兼容端点，内置固定优先级路由、
响应前 Fallback、虚拟密钥限流与预算、费用统计和请求日志。适配 Cloudflare Free Tier，
不依赖 KV、R2、Queues 或 Durable Objects。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Leon00x/mygateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml/badge.svg)](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

## 这是什么

- 应用只连接一个 Gateway 地址，不散落多个 Provider Key；
- 统一模型 ID，按管理员保存的顺序选择渠道，首选渠道失败时自动尝试备用；
- 客户端可选 Chat、Responses 或 Messages 协议，控制台一站式管理。

```text
部署并修改初始密码 → 添加供应商渠道 → 创建统一模型 → 创建 Gateway Key → 调用 /v1/*
```

## 核心特性

- **统一网关**：OpenAI Chat / Responses、Anthropic Messages 端点，协议转换、SSE 流式、
  响应前 Fallback、被动熔断。[详见 PRD](docs/PRD.md)
- **管理控制台**：渠道 / 模型 / 密钥 / 用量 / 日志一站式管理，中英双语、浅色暗黑主题。
- **虚拟密钥**：RPM、每日请求与 Token 预算、到期时间、模型白名单，超额 429/403。
- **用量与日志**：5 分钟聚合统计（Token、费用、延迟、TTFT），请求日志独立开关、
  可选加密上下文预览、7 天保留。
- **供应商预制**：12 家供应商一键接入，只声明经过确认的原生协议。

## 快速开始

### Deploy Button

1. 点击上方按钮并登录 Cloudflare；
2. 选择或 Fork `Leon00x/mygateway`；
3. Cloudflare 创建 Worker、Static Assets 与 D1，部署脚本运行 migrations 并初始化
   `MASTER_KEY`（部署日志中只显示一次，请立即保存）；
4. 打开生成的 `https://mygatewaydemo.<子域>.workers.dev`，首次登录：

```text
用户名：admin
密码：mygateway123
```

首次登录必须修改用户名和密码。完整部署、Secrets 与排障见 [部署指南](docs/DEPLOY.md)。

### 本地开发

```bash
git clone https://github.com/Leon00x/mygateway
cd mygateway
npm install
npm run dev:setup   # 本地 D1 migrations
npm run dev         # http://localhost:8787
```

### 调用示例

```bash
curl https://your-gateway.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-model","messages":[{"role":"user","content":"Hello"}]}'
```

## 支持的供应商

OpenAI、Anthropic、DeepSeek、Z.AI、华为云（中国）、阿里云国际、火山国际（BytePlus）、
Google Gemini、Groq、MiniMax 国际、xAI、Mistral AI。

## 对外接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/models` | 列出统一模型和公开别名 |
| POST | `/v1/chat/completions` | OpenAI Chat Completions |
| POST | `/v1/responses` | OpenAI Responses |
| POST | `/v1/messages` | Anthropic Messages |
| GET | `/v1/openapi.json` | OpenAPI 文档 |
| GET | `/v1/api-docs` | API 文档页面 |
| GET | `/health` | 健康检查 |

## 文档

- [产品需求（PRD）](docs/PRD.md) — 特性总览与详细行为、产品边界、Roadmap
- [架构](docs/ARCHITECTURE.md) · [详细设计](docs/DESIGN.md)
- [部署](docs/DEPLOY.md) · [测试](docs/TESTING.md) · [更新记录](CHANGELOG.md)
- [贡献](CONTRIBUTING.md) · [安全](SECURITY.md) · 许可：MIT（[LICENSE](LICENSE)）

## 开发与验证

```bash
npm test              # 单元测试
npm run typecheck
npm run build         # 构建 + 部署预检
npm run test:e2e      # UI E2E
```

测试环境准备与用例清单见 [测试指南](docs/TESTING.md)。
