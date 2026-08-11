# 安全策略

[English](SECURITY.md) · [简体中文](SECURITY.zh-CN.md)

## 报告安全漏洞

请勿在公开 Issue 中发布凭据、Prompt、响应、数据库导出、利用细节或生产地址。优先使用 GitHub 私密漏洞报告或 Security Advisory；如果该入口不可用，请只提交一个不含敏感内容的简短 Issue，向维护者索取私密联系方式。

报告中请包含受影响版本或 Commit、影响范围、复现条件，以及已知的缓解建议。建议在公开细节前等待维护者确认，并采用协调披露方式。

## 支持版本

MyGateway 当前是 `0.1.x` 公测版本。安全修复只面向最新 `main`；本仓库不维护旧 Commit 和 Fork 的自定义修改。

## 部署方责任

- 首次登录后立即替换初始管理员凭据。
- 将 `MASTER_KEY` 备份到密码管理器，不要提交到仓库或随意轮换；丢失后无法恢复已加密的 Provider Key。
- 不要在 Issue、日志、截图、Trace 或测试产物中暴露 Provider Key 和 Gateway Key。
- 上下文日志默认关闭；只在确有需要时开启，并使用尽可能短的保留期。
- 管理登录目前没有跨 isolate 的持久防暴力破解机制，不应无必要地公开控制台地址；加固状态以 [PRD](PRD.md) 为准。

密钥存储、会话、日志和一致性边界见[技术架构](ARCHITECTURE.md)。
