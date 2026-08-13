# MyGateway 文档导航

[English](README.md) · [简体中文](README.zh-CN.md)

本目录将产品决策、工程约束、部署运维和项目规范与根目录 README 分开。修改产品行为时先阅读产品与架构文档；部署或参与开发时使用对应的操作指南。

## 文档地图

| 领域 | 文档 | 语言 | 权威范围 |
|---|---|---|---|
| 产品 | [PRD](PRD.md) | 中文 | 产品范围、实现状态、边界和 Roadmap，是产品行为的权威来源 |
| 架构 | [技术架构](ARCHITECTURE.md) | 中文 | 系统边界、数据流、D1、缓存、安全和一致性 |
| 设计 | [详细设计](DESIGN.md) | 中文 | 协议、供应商、模型、Analytics、价格和管理 API 决策 |
| 供应商 | [供应商与模型](PROVIDERS.md) | 中文 | 供应商预制、模型价格基线和余额支持情况 |
| 部署 | [中文](DEPLOY.md) · [English](DEPLOY.en.md) | 中文 / EN | 部署、升级、回滚、排障和免费额度规划 |
| 测试 | [测试指南](TESTING.md) | 中文 | 测试分层、Fixture、集成测试和发布检查 |
| 贡献 | [中文](CONTRIBUTING.zh-CN.md) · [English](CONTRIBUTING.md) | 中文 / EN | 开发流程和 Pull Request 要求 |
| 安全 | [中文](SECURITY.zh-CN.md) · [English](SECURITY.md) | 中文 / EN | 私密漏洞报告和部署方责任 |
| 版本 | [更新日志](CHANGELOG.md) | 中文 | 已发布和待发布变化 |
| Agent | [AGENTS.md](../AGENTS.md) | 中文 | AI 辅助开发必须遵守的仓库规则 |
| 维护记录 | [内部文档](internal/README.md) | 中文 | 单次部署、实验和开发过程；不属于产品文档，可独立移除 |

## 推荐阅读路径

- **部署 MyGateway**：README → 部署指南 → 安全策略
- **修改产品行为**：PRD → 技术架构 → 对应详细设计 → 测试指南
- **增加供应商或协议**：供应商基线 → 详细设计 → 技术架构 → 测试指南
- **参与代码开发**：贡献指南 → AGENTS.md → 测试指南

## 维护规则

- `PRD.md` 是用户可见行为和 Roadmap 状态的权威来源。
- migration 是数据库 Schema 的权威来源，已经发布的 migration 不得修改。
- 架构文档描述已经实现的系统结构，详细设计文档解释具体决策。
- README 保持精简，通过链接进入详细文档，不重复实现细节。
- 修改双语公共文档时，应同步更新两种语言版本。
- 个人环境、单次生产验证、实验过程和临时排障只进入 `docs/internal/`，不得写入 PRD、部署指南或
  测试方法；删除整个内部目录不应影响使用和二次开发。
