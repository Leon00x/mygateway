# 供应商与模型基线

本文记录内置供应商预制、模型价格基线和余额 / 套餐查询边界。协议转换与路由规则见
[详细设计](DESIGN.md)，产品状态见 [PRD](PRD.md)。

价格和供应商能力会变化。这里的结论最后核验于 **2026-08-11**；代码中的端点和模型建议以
`src/shared/provider-presets.ts` 为准，数据库价格以 `migrations/0001_initial.sql` 中的当前发布基线为准。

## 1. 重点维护的 10 个预制

项目内置 15 个供应商预制，其中以下 10 个按当前官方端点和主流模型持续核验。预制只提供
连接初值，不代表任意账号或 Key 都能访问所列模型；保存前仍需执行模型发现或手工确认。

| 供应商 | 区域 / 根地址 | 原生协议 | 当前建议模型 |
|---|---|---|---|
| DeepSeek | `api.deepseek.com` | Chat、Messages | DeepSeek V4 Flash / Pro |
| Z.AI | 国际站 | Chat | GLM-5.1、GLM-5、GLM-4.7 |
| 华为云 | 中国区 ModelArts Studio | Chat、Messages | GLM-5.2、DeepSeek V4 Pro / Flash |
| 阿里云 | 新加坡 Model Studio | Chat、Messages | Qwen3.7 Max / Plus、Qwen3.6 Flash |
| BytePlus | 新加坡 ModelArk | Chat、Responses | Seed 2.0 Pro / Lite / Mini |
| Google | Gemini API | Chat 兼容 | Gemini 3.6 Flash、3.5 Flash / Flash-Lite |
| Groq | GroqCloud | Chat、Responses | GPT OSS 120B / 20B、Llama 3.3 70B |
| MiniMax | 国际站 | Chat、Messages | MiniMax M3、M2.7 / Highspeed |
| xAI | 官方 API | Chat、Responses | Grok 4.5、Grok 4.3 |
| Mistral | 官方 API | Chat | Large 3、Medium 3.5、Small 4 |

此外保留 OpenAI、Anthropic、SiliconFlow、Moonshot（Kimi）和智谱（中国）预制。自定义渠道
允许接入其他 OpenAI-compatible 或 Anthropic Messages 端点。

## 2. 30 个模型价格基线

数值单位为 **USD / 1M Token**。缓存列表示缓存读取 / 命中价，`—` 表示没有录入可直接比较的
缓存读取单价。Qwen 和 Seed 的数值采用官方标准按量价的最短上下文首档；超过上下文门槛、Batch、
Flex、地域、促销、缓存写入和专属套餐可能使用不同价格。Claude Sonnet 采用长期标准价，不采用
限时优惠价。

| 供应商 | 模型 ID | 输入 | 缓存输入 | 输出 |
|---|---|---:|---:|---:|
| DeepSeek | `deepseek-v4-flash` | 0.14 | 0.0028 | 0.28 |
| DeepSeek | `deepseek-v4-pro` | 0.435 | 0.003625 | 0.87 |
| Z.AI | `glm-5.1` | 1.40 | 0.26 | 4.40 |
| Z.AI | `glm-5` | 1.00 | 0.20 | 3.20 |
| Z.AI | `glm-4.7` | 0.60 | 0.11 | 2.20 |
| Alibaba | `qwen3.7-max` | 2.50 | — | 7.50 |
| Alibaba | `qwen3.7-plus` | 0.40 | — | 1.60 |
| Alibaba | `qwen3.6-flash` | 0.25 | — | 1.50 |
| BytePlus | `seed-2-0-pro-260328` | 0.50 | 0.10 | 3.00 |
| BytePlus | `seed-2-0-lite-260428` | 0.25 | 0.05 | 2.00 |
| BytePlus | `seed-2-0-mini-260428` | 0.10 | 0.02 | 0.40 |
| Google | `gemini-3.6-flash` | 1.50 | 0.15 | 7.50 |
| Google | `gemini-3.5-flash` | 1.50 | 0.15 | 9.00 |
| Google | `gemini-3.5-flash-lite` | 0.30 | 0.03 | 2.50 |
| Groq | `openai/gpt-oss-120b` | 0.15 | — | 0.60 |
| Groq | `openai/gpt-oss-20b` | 0.075 | — | 0.30 |
| Groq | `llama-3.3-70b-versatile` | 0.59 | — | 0.79 |
| MiniMax | `MiniMax-M3` | 0.30 | 0.06 | 1.20 |
| MiniMax | `MiniMax-M2.7` | 0.30 | 0.06 | 1.20 |
| MiniMax | `MiniMax-M2.7-highspeed` | 0.60 | 0.06 | 2.40 |
| xAI | `grok-4.5` | 2.00 | 0.30 | 6.00 |
| xAI | `grok-4.3` | 1.25 | 0.20 | 2.50 |
| Mistral | `mistral-large-2512` | 0.50 | — | 1.50 |
| Mistral | `mistral-medium-3-5` | 1.50 | — | 7.50 |
| Mistral | `mistral-small-2603` | 0.15 | — | 0.60 |
| OpenAI | `gpt-5.4` | 2.50 | 0.25 | 15.00 |
| OpenAI | `gpt-5.4-mini` | 0.75 | 0.075 | 4.50 |
| OpenAI | `gpt-5.4-nano` | 0.20 | 0.02 | 1.25 |
| Anthropic | `claude-opus-5` | 5.00 | 0.50 | 25.00 |
| Anthropic | `claude-sonnet-5` | 3.00 | 0.30 | 15.00 |

价格来源：

- [DeepSeek Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [Z.AI Pricing](https://docs.z.ai/guides/overview/pricing)
- [Alibaba Cloud Model Pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [BytePlus ModelArk Model List and Pricing](https://docs.byteplus.com/docs/ModelArk/1099320)
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Groq Supported Models](https://console.groq.com/docs/models)
- [MiniMax Pay-as-you-go Pricing](https://platform.minimax.io/docs/guides/pricing-paygo)
- [xAI Pricing](https://docs.x.ai/developers/pricing)
- [Mistral Model Catalog](https://docs.mistral.ai/getting-started/models/models_overview/)
- [OpenAI Model Catalog](https://developers.openai.com/api/docs/models)
- [Claude Pricing](https://platform.claude.com/docs/en/about-claude/pricing)

价格库用于新建渠道实例时预填和网关内费用估算，**不是供应商账单**。未来价格 migration 必须
保留管理员编辑过的条目；当前费用聚合也尚未按币种拆分。

## 3. 余额与套餐查询可行性

不能因为推理 Key 可以调用模型，就假设它能读取账户账单。控制面凭据通常权限更高，也不应与
推理 Key 一起保存。当前产品只实现 DeepSeek 官方余额查询，其余结论用于后续 Adapter 设计。

| 供应商 | 使用当前推理 / MaaS Key | 结论 |
|---|---|---|
| DeepSeek | 可读取账户余额 | ✅ 已实现 `/user/balance`，仅允许官方主机 |
| Z.AI | 官方推理文档未提供余额端点 | 暂不接入；继续由控制台查看余额 |
| 华为云 | MaaS Key 不能代替 IAM Token / AK-SK | 不使用当前 Key 查询账户费用 |
| 阿里云 | DashScope / Token Plan Key 不等于费用中心凭据 | 账单与用量需账号控制面权限，不接入当前 Key |
| BytePlus | `GetUsage` 属于签名控制面 API | 需要 Access Key，不能复用 ModelArk 推理 Key |
| Google | API Key 继承 Cloud Billing 项目状态 | 余额 / 账单需 Cloud Billing IAM，不复用推理 Key |
| Groq | 官方只提供 Console Usage / Billing | 未发现推理 Key 可用的余额端点 |
| MiniMax | Token Plan Key 可查询剩余额度 | 可扩展 `/v1/token_plan/remains`；需先区分 Token Plan 与 PAYG Key |
| xAI | 余额和 Usage 在团队 Console | 未发现推理 Key 可用的余额端点 |
| Mistral | Usage API 需要单独的 Admin API Key | 不复用普通推理 Key；未来可设计独立只读凭据 |

相关官方说明：

- [DeepSeek Get User Balance](https://api-docs.deepseek.com/api/get-user-balance)
- [Huawei Cloud MaaS API Reference](https://support.huaweicloud.com/intl/en-us/api-maas/MaaS%20API%20Reference-pdf.pdf)
- [Alibaba Cloud Bill Query and Cost Management](https://www.alibabacloud.com/help/en/model-studio/bill-query-and-cost-management)
- [BytePlus GetUsage](https://docs.byteplus.com/en/docs/ModelArk/1390292)
- [Gemini API Billing](https://ai.google.dev/gemini-api/docs/billing)
- [Groq Billing FAQs](https://console.groq.com/docs/billing-faqs)
- [MiniMax Token Plan](https://platform.minimax.io/docs/token-plan/intro)
- [xAI Manage Billing](https://docs.x.ai/console/billing)
- [Mistral Admin Usage API](https://docs.mistral.ai/admin/admin-api/usage-metrics)

下一阶段若扩展余额能力，应把 `monetary_balance`、`subscription_quota` 和 `billing_usage` 分成
不同结果类型；不同币种、滚动窗口和请求配额不能汇总成一个“余额”数字。
