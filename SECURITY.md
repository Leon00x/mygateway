# Security

面向个人开发者与小团队的轻量网关，安全做到“够用”即可。

发现安全问题直接开 issue 说明即可，避免在 issue 里贴出密钥或日志原文。

部署提醒：

- `MASTER_KEY` 首次部署只显示一次，保存在 Cloudflare Secrets 中，不要提交到代码仓库；
- Provider Key 由网关加密存储，Gateway Key 只保存哈希，明文都不会再次展示。
