# DeepSeek 官方账户余额查询

## 目标与边界

MyGateway 只为主机名严格等于 `api.deepseek.com` 的官方 DeepSeek 渠道提供余额查询。
DeepSeek 模型的第三方托管渠道不会被误判为 DeepSeek 官方账户，也不会使用其 Key
访问 DeepSeek。

余额来自 DeepSeek 官方的 `GET https://api.deepseek.com/user/balance`，使用渠道中已加密
保存的 API Key 做 Bearer 鉴权。返回的 `CNY` / `USD` 总余额、赠金余额和充值余额始终以
字符串解析和展示，避免 JavaScript 浮点数改变金额精度。接口定义见
[DeepSeek 官方文档](https://api-docs.deepseek.com/zh-cn/api/get-user-balance)。

余额是供应商账户维度的数据，不是单次请求统计，也不等同于 Token 套餐余量。多个渠道
可能属于不同账户，因此 UI 逐渠道、逐币种展示，绝不跨账户或跨币种求和。

## 管理 API

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/admin/api/channels/balances` | 仅读取当前 Worker isolate 的短缓存；未查询返回 `not_queried` |
| GET | `/admin/api/channels/balances?refresh=1` | 主动刷新所有受支持渠道 |
| GET | `/admin/api/channels/:id/balance` | 读取该渠道缓存，未命中时按需查询 |
| GET | `/admin/api/channels/:id/balance?refresh=1` | 强制刷新该渠道 |

成功结果包含 `is_available`、`balance_infos`、`fetched_at` 和 `cached`。上游鉴权、超时、
非 JSON 或字段校验失败时返回 `502` 和已清理的错误说明，不回显 Provider 响应正文或 Key。
非官方 DeepSeek 渠道返回 `422`。

## 页面展示

- **Channels**：在官方 DeepSeek 渠道行内显示账户可用状态、各币种总余额、赠金、充值
  余额和更新时间；提供单渠道“查询余额 / 刷新余额”。
- **Dashboard**：存在受支持的活动渠道时显示独立的 `Provider Balance` 卡片；首次进入只
  读取缓存，用户点击刷新后才访问 DeepSeek；刷新请求带 `active=1`，不会查询停用渠道。
- 查询失败不会影响渠道配置、模型路由或业务请求。

## 免费档与安全设计

- 成功结果仅在 Worker isolate 内缓存 5 分钟，最多 200 个渠道；不新增 D1、KV、Queues、
  Durable Objects 或 Cron 写入。
- 相同渠道的并发查询会合并为一次 Provider 请求。
- 更新渠道配置或删除渠道时立即使缓存失效；更新期间尚未完成的旧 Key 查询不能回填缓存。
- Provider Key 只在 Worker 内解密，不返回浏览器、不写日志。
- 单次查询超时 10 秒，响应体上限 64 KiB。

这套缓存是尽力而为的：Worker isolate 回收后余额会回到 `not_queried`，这是免费档设计的
预期行为，不影响数据面的可用性。
