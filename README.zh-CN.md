<div align="center">

# MyGateway

**为 Cloudflare 打造的自托管 AI 网关。**

通过一套 API、一套密钥体系和一个管理控制台接入多家 AI 供应商，无需维护独立服务器。

[English](README.md) · [简体中文](README.zh-CN.md)

[![部署到 Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Leon00x/mygateway)

[![CI](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml/badge.svg)](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

</div>

> MyGateway 目前是 `0.1.x` 公测版本，面向希望网关保持轻量、透明的个人项目和小团队。如果你需要数百家供应商、复杂租户权限和完整 LLMOps 平台，建议选择 [LiteLLM](https://github.com/BerriAI/litellm) 等成熟项目。

## 为什么选择 MyGateway

- **Cloudflare 原生**：只使用 Worker、Static Assets、D1、Secrets 和单个 Cron，无需常驻服务器。
- **统一网关 API**：通过 Gateway Key 调用 OpenAI Chat、OpenAI Responses 和 Anthropic Messages。
- **路由行为可预期**：统一模型、原生协议优先、固定优先级、Fallback 和被动熔断。
- **自带管理控制台**：集中管理供应商、模型、密钥、用量、日志、价格和系统设置。
- **数据由自己掌控**：Provider Key 加密保存，Gateway Key 只存哈希，默认不保存对话内容。
- **支持 Agent 运维**：签发独立 Management Key，并向 AI Agent 提供同源托管的管理 Skill。

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
| **模型与路由** | 统一模型 ID、直达别名、有序渠道实例、Fallback 和被动熔断 |
| **API 密钥** | 到期时间、模型权限、RPM、每日请求限额和 Token 预算 |
| **用量分析** | 请求与 Token 趋势、延迟、首 Token 延迟、成功率、预估费用和请求日志 |
| **管理控制台** | 中英双语、明暗主题、渠道、模型、价格、密钥、日志和系统设置 |
| **Agent 管理** | 独立只读/可写 Management Key，以及同源托管的 `/skill.md` |
| **安全** | Provider 凭据加密、调用密钥哈希、管理员会话保护和可选加密上下文预览 |

完整的实现状态与 Roadmap 以 [PRD](docs/PRD.md) 为准。

## 一键部署

点击 **部署到 Cloudflare**，连接或 Fork 仓库，并保留自动识别的构建和部署命令。部署流程会创建 Worker、Static Assets、D1 数据库，执行迁移并初始化必要 Secrets。

首次登录凭据：

```text
用户名：admin
密码：mygateway123
```

首次登录后必须修改。请妥善保存 `MASTER_KEY`：丢失或替换后，已有 Provider 凭据将无法解密。

升级、回滚、排障和免费额度规划见[部署指南](docs/DEPLOY.md)。

## 本地开发

需要 Node.js 22 或更高版本。

```bash
git clone https://github.com/Leon00x/mygateway.git
cd mygateway
npm install
cp .dev.vars.example .dev.vars
# 设置 MASTER_KEY，例如：openssl rand -base64 32
npm run dev:setup
npm run dev
```

浏览器打开 <http://localhost:8787>。提交改动前运行：

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

在 **系统设置 → 管理密钥与 Skill** 创建只读或可写 Management Key，再将页面生成的配置提示词交给 Agent。每个部署都会在 `/skill.md` 托管自己的可审查 Skill，用于管理渠道、模型、Gateway Key，以及查询余额、用量、日志和健康状态。

Management Key 与模型调用使用的 Gateway Key 相互隔离，Management API 不会返回 Provider 凭据。

## 当前边界

- Fallback 只能发生在响应内容开始发送前；流式输出开始后不能切换供应商。
- RPM 和熔断状态是 isolate 内尽力控制；每日请求和 Token 预算以 D1 为权威数据。
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
