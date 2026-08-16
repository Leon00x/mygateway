<div align="center">

# MyGateway

**简单、好用，可以交给 AI Agent 管理的多渠道 AI 网关。**

通过一套 API、一套密钥体系和一个管理控制台接入多家 AI 供应商，无需维护独立服务器。

[English](README.md) · [简体中文](README.zh-CN.md)

[![部署到 Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Leon00x/mygateway)

[![CI](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml/badge.svg)](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

</div>

> MyGateway 目前是 `0.1.x` 公测版本，面向希望网关保持轻量、透明的个人项目和小团队。如果你需要数百家供应商、复杂租户权限和完整 LLMOps 平台，建议选择 [LiteLLM](https://github.com/BerriAI/litellm) 等成熟项目。

## 为什么选择 MyGateway

1. **一键部署到 Cloudflare**：无需维护服务器，默认架构适配 Cloudflare Free Tier，免费额度可以满足大多数个人和小团队的日常使用。
2. **一个模型可以使用多个渠道**：把不同供应商的同类模型放在同一个模型名称下，可按价格安排渠道优先级，也可以自定义调用顺序；首选渠道异常时自动切换。
3. **通过熟悉的 AI Agent 管理网关**：提供官方 Skill，让 Codex、Claude Code、Pi 等 Agent 帮你检查网关状态、添加供应商和模型、管理调用密钥，以及查询余额、用量和日志。

同时支持 OpenAI Chat、OpenAI Responses 和 Anthropic Messages 接口，并提供用量限额、费用统计、请求日志和中英文界面。

```text
应用 / SDK
    │  Chat Completions · Responses · Messages
    ▼
MyGateway Worker ── 鉴权与限额 ── 路由与 Fallback ── AI 供应商
    │
    ├── SolidJS 管理控制台
    └── D1：配置、用量聚合、可选请求日志
```

## 功能模块

| 模块 | 核心能力 |
|---|---|
| **网关接口** | OpenAI Chat、OpenAI Responses、Anthropic Messages 和模型发现接口 |
| **供应商渠道** | 供应商预制、自定义端点、连接检测、模型发现和凭据加密 |
| **模型与路由** | 一个模型绑定多个渠道、按价格或偏好设置调用顺序，并在渠道故障时自动切换 |
| **API 密钥** | 到期时间、模型权限、RPM，以及按日、周、月或年计算的请求 / Token 预算 |
| **用量分析** | 请求与 Token 趋势、延迟、首 Token 延迟、成功率、预估费用和请求日志 |
| **管理控制台** | 中英双语、明暗主题、渠道、模型、价格、密钥、日志和系统设置 |
| **Agent 管理** | 安装官方 Skill 后，通过常用 AI Agent 管理供应商、模型和密钥，查询余额、用量与日志 |
| **安全** | Provider 凭据加密、调用密钥哈希、管理员会话保护和可选加密上下文预览 |

完整的实现状态与 Roadmap 以 [PRD](docs/PRD.md) 为准。

## 一键部署

直接点击 **部署到 Cloudflare**。Cloudflare 会在你的 GitHub 或 GitLab 账号下创建独立仓库，使用预填的 `mygateway` 名称创建 Worker 和 D1、执行 migration，并自动生成内部加密 Secret；无需提前 Fork。部署时唯一展示的应用配置是初始管理员密码，默认 `mygateway123`，用户可以在部署前修改。

首次登录凭据：

```text
用户名：admin
密码：mygateway123
```

首次登录后必须修改。`MASTER_KEY` 由 MyGateway 自动创建并作为内部 Cloudflare Secret 保存，日常无需管理；存入 Provider 凭据后请勿删除或轮换。

升级、回滚、排障和免费额度规划见[部署指南](docs/DEPLOY.md)。

## 本地运行

需要 Node.js 22 或更高版本。

```bash
git clone https://github.com/Leon00x/mygateway.git
cd mygateway
npm run local
```

该命令会在需要时安装锁定依赖、创建仅供本地使用的 Secret、构建控制台、执行 D1 migration，并在 <http://localhost:8787> 启动 MyGateway。本地数据保存在 Wrangler 的本地状态中。使用 `admin` / `mygateway123` 登录并修改凭据。

手工开发流程和测试命令见[贡献指南](docs/CONTRIBUTING.zh-CN.md)。提交改动前运行：

```bash
npm run typecheck
npm test
npm run build
```

## 调用示例

```bash
curl https://your-gateway.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-model","messages":[{"role":"user","content":"你好"}]}'
```

Anthropic 客户端可以把 Base URL 指向同一部署地址，并通过 `x-api-key` 调用 `/v1/messages`。Responses 请求使用供应商原生 Responses 端点。

## Agent 管理

MyGateway 提供官方 Skill，可以直接通过 Codex、Claude Code、Pi 等你熟悉的 AI Agent 管理网关。Agent 能检查当前配置，添加或删除供应商和模型、管理调用密钥，并查询余额、用量、日志和运行状态；执行关键操作前会先向你确认。

在 **系统设置 → 管理密钥与 Skill** 创建 Agent 管理凭据，再把页面提供的一行安装提示词交给 Agent 即可开始。该凭据只用于授权管理操作，不会向 Agent 返回供应商密钥。

## 当前边界

- Fallback 只能发生在响应内容开始发送前；流式输出开始后不能切换供应商。
- RPM 和熔断状态是 isolate 内尽力控制；日 / 周 / 月 / 年请求和 Token 预算以 D1 每日台账为权威数据。
- Token 和费用依赖供应商上报，预估费用不等同于供应商账单。
- 费用聚合目前没有币种维度，同一部署应统一使用一种记账币种。
- 暂不支持 Embeddings、Images、Audio、Realtime、Batch、Files、多用户和 RBAC。

## 项目文档

建议从[文档导航](docs/README.zh-CN.md)开始。

| 文档 | 用途 |
|---|---|
| [产品需求](docs/PRD.md) | 产品范围、实现状态、边界和 Roadmap |
| [技术架构](docs/ARCHITECTURE.md) | 控制面、数据面、存储、缓存和一致性 |
| [详细设计](docs/DESIGN.md) | 协议转换、供应商、模型发现、Analytics 和价格逻辑 |
| [部署指南](docs/DEPLOY.md) | 部署、升级、回滚、排障和免费额度规划 |
| [测试指南](docs/TESTING.md) | 单测、UI、可控上游和真实供应商验证 |
| [贡献指南](docs/CONTRIBUTING.zh-CN.md) | 开发流程和贡献要求 |
| [安全策略](docs/SECURITY.zh-CN.md) | 漏洞报告和部署方安全责任 |
| [Agent 指南](AGENTS.md) | AI 辅助开发必须遵守的仓库约束 |

## 参与项目

欢迎提交 Issue 和 Pull Request。修改前请阅读[贡献指南](docs/CONTRIBUTING.zh-CN.md)，安全问题请按照[安全策略](docs/SECURITY.zh-CN.md)私下报告。

MyGateway 使用 [MIT License](LICENSE) 开源。
