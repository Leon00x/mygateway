# MyGateway

**为个人开发者和小团队准备的 Cloudflare AI API 网关。** 只需一个 Worker 和一个 D1，
即可用统一 Key 调用多家模型供应商，并在网页控制台管理路由、密钥、用量和请求日志。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Leon00x/mygateway)
[![CI](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml/badge.svg)](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

> MyGateway 目前是 `0.1.x` 原型版，适合个人项目、测试环境和可接受当前一致性边界的小团队。
> 它不是 LiteLLM 的完整替代品；需要上百家 Provider、企业权限、共享强限流或完整 LLMOps
> 能力时，优先考虑 [LiteLLM](https://github.com/BerriAI/litellm) 等成熟方案。

## 为什么是 MyGateway

- **部署简单**：Cloudflare Deploy Button，默认只创建 Worker、Static Assets 和 D1。
- **统一调用**：OpenAI Chat / Responses 与 Anthropic Messages 兼容端点，一份 Gateway Key
  管理所有已配置模型。
- **路由可解释**：固定优先级、原生协议优先、响应提交前 Fallback、isolate 内被动熔断。
- **自带控制台**：渠道、模型、虚拟密钥、用量、费用和日志集中管理，中英双语和明暗主题。
- **免费额度优先**：不依赖 KV、R2、Queues、Durable Objects、Redis 或独立数据库服务。
- **数据留在自己账号**：Provider Key 加密存入 D1，Gateway Key 只存哈希；默认不保存对话正文。

```text
应用 / SDK
   │  OpenAI Chat · OpenAI Responses · Anthropic Messages
   ▼
MyGateway Worker ── Gateway Key / 配额 ── 固定路由 / Fallback ── AI Provider
   │
   ├── SolidJS 管理控制台
   └── D1：配置、聚合用量、可选请求日志
```

## 已实现能力

| 模块 | 能力 |
|---|---|
| Gateway | `/v1/chat/completions`、`/v1/responses`、`/v1/messages`、`/v1/models` |
| 协议 | 原生协议优先；Chat ↔ Messages 文本、工具调用、usage 与 SSE 公共子集转换 |
| 路由 | 统一模型、渠道实例、公开别名、固定优先级、响应前 Fallback、被动熔断 |
| 虚拟密钥 | RPM、每日请求 / Token 预算、到期时间、模型白名单 |
| Analytics | 5 分钟聚合、Token、预估费用、延迟、首 Token 延迟、成功率与请求日志 |
| 控制台 | 渠道检测和模型导入、模型与价格库、密钥、用量、日志、系统设置 |
| 安全 | 管理员 Session、Provider Key AES-GCM、Gateway Key 哈希与到期控制、可选加密上下文预览 |

完整状态、行为和 Roadmap 以 [PRD](docs/PRD.md) 为准。

## 一键部署

1. 点击 **Deploy to Cloudflare**，登录并选择创建或 Fork 仓库；
2. 保留系统识别出的 `npm run build` / `npm run deploy` 命令，确认 D1 绑定；
3. 等待 migrations、Worker、Static Assets 和首次 Secrets 初始化完成；
4. 保存部署日志中首次生成的 `MASTER_KEY`，打开 Worker 地址并登录：

```text
用户名：admin
密码：mygateway123
```

首次登录会强制修改凭据。`MASTER_KEY` 丢失或被替换后，已有 Provider Key 将无法解密。
升级、手动部署和常见故障见 [部署指南](docs/DEPLOY.md)。

## 本地开发

需要 Node.js 22+。

```bash
git clone https://github.com/Leon00x/mygateway.git
cd mygateway
npm install
cp .dev.vars.example .dev.vars
# 填写 MASTER_KEY：openssl rand -base64 32
npm run dev:setup
npm run dev
```

浏览器打开 <http://localhost:8787>。提交改动前运行：

```bash
npm run typecheck     # Worker + Dashboard
npm test
npm run build         # Dashboard 构建 + Worker dry-run
```

## 调用示例

OpenAI 兼容调用：

```bash
curl https://your-gateway.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-model","messages":[{"role":"user","content":"Hello"}]}'
```

Anthropic SDK 可将 Base URL 指向 `https://your-gateway.workers.dev`，并把 Gateway Key 作为
`x-api-key` 传入 `/v1/messages`。Responses 当前只走供应商原生 Responses 端点，不做协议转换。

## 供应商预制

当前内置 15 个预制：OpenAI、Anthropic、DeepSeek、Z.AI、华为云（中国）、阿里云国际、
火山国际（BytePlus）、Google Gemini、Groq、MiniMax 国际、xAI、Mistral AI、SiliconFlow、
Moonshot（Kimi）和智谱（中国）。也可以添加自定义 OpenAI-compatible / Messages 渠道。

预制只声明项目已确认的原生协议；“出现在模型列表”不代表系统会猜测其协议能力。

## 当前边界

- Fallback 只发生在响应提交前；流已经输出后不会跨 Provider 续接。
- RPM 和熔断是 isolate 内尽力状态；每日请求 / Token 预算以 D1 为准，但短刷新窗口内可能超量。
- Token 和费用依赖 Provider 上报，不做本地分词猜测；价格统计不是 Provider 账单。
- 当前费用聚合没有币种维度。使用 CNY 价格与 USD 价格混合统计会失真，正式修复前请为所有
  渠道统一使用同一种记账币种。
- 不支持 Embeddings、Images、Audio、Realtime、Batch、Files、多用户或 RBAC。

## 文档

| 文档 | 适合何时阅读 |
|---|---|
| [PRD](docs/PRD.md) | 查看产品分层、已实现 / 部分实现 / 待实现和优先级 |
| [架构](docs/ARCHITECTURE.md) | 理解控制面、数据面、D1、缓存和一致性边界 |
| [详细设计](docs/DESIGN.md) | 修改协议转换、供应商、模型发现、Analytics 或价格逻辑 |
| [供应商与模型](docs/PROVIDERS.md) | 核对重点预制、30 个价格基线和余额 / 套餐接入边界 |
| [部署](docs/DEPLOY.md) | 一键部署、升级、回滚、Free Tier 和排障 |
| [测试](docs/TESTING.md) | 单测、UI E2E、真实 Provider 集成和发布检查 |
| [AGENTS.md](AGENTS.md) | AI Agent 接续开发时必须遵守的仓库约束 |

## 参与项目

欢迎提交 Issue 和 Pull Request。开始前请阅读 [CONTRIBUTING](CONTRIBUTING.md)；安全问题请按
[SECURITY](SECURITY.md) 私下报告。版本变化见 [CHANGELOG](CHANGELOG.md)。

MyGateway 使用 [MIT License](LICENSE) 开源。
