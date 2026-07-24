
# PRD：Cloudflare AI Aggregation Gateway

## 1. 产品概述

一个超轻量、开源、可一键部署到 Cloudflare 的 AI 聚合网关。

用户可以将多个 AI 服务渠道接入，通过统一入口调用，并实现模型管理、自动路由、额度管理和使用情况查看。

目标：

- 基于 Cloudflare 免费资源运行
- 用户部署到自己的 Cloudflare 账号
- 无需服务器、无需复杂运维


---

# 2. 核心功能

## 2.1 渠道管理

支持接入多个 AI Provider。

例如：

- DeepSeek
- OpenAI
- Gemini
- Claude
- 其他 OpenAI Compatible API


功能：

- OAuth / API Key 接入
- 渠道配置管理
- 查看渠道余额  （也支持手动输入）
- 查看套餐剩余量 （也支持手动定义）
- 渠道状态管理 (停用 启用 删除)


---

## 2.2 模型管理

统一管理已接入模型。


功能：

- 展示所有已接入模型
- 自定义统一模型 ID 调用不同渠道的相同模型
- 支持每个渠道的每个模型单独的前缀
- 如果用统一模型id 调用 则 据规则自动选择调用渠道的同一个模型（ 自己设定， 套餐优先， 成本优先）
  （例如 统一模型id  deepseek-v4-flash  ； 渠道1 唯一id：  hw-deepseek-v4-flash  渠道2 ali-deepseek-v4-flash， 用统一id 调用模型会自动根据规则路由） 



支持：

- 按价格路由
- 按优先级路由
- 最大化缓存命中


---

### 2.2.2 自动路由

根据配置自动选择最佳渠道。



---

## 2.4 接入点管理

创建统一 AI Gateway 接入地址。


功能：

- 创建 API Key
- 管理访问密钥
- 获取不同接口协议地址： openai chat / response  等


## 2.5 使用看板

展示 AI 使用情况。


包括：

- 总调用量
- Token 使用量
- 各模型调用情况
- 各渠道使用情况
- 渠道余额和剩余额度


示例：

```

DeepSeek
Usage: 70%

OpenAI
Usage: 30%

```


---

# 3. 部署方式


基于 Cloudflare：

组件：

- Cloudflare Workers
- Cloudflare D1
- Cloudflare KV
- Cloudflare Pages（可选）


部署方式：

```

GitHub

↓

One Click Deploy

↓

用户自己的 Cloudflare Account

↓

自动创建 AI Gateway

```


---

# 4. 产品特点


- 开源
- 超轻量
- Cloudflare 原生
- 一键部署
- 无服务器成本
- 用户自己管理 API Key


---

# 5. 参考项目

可基于：

- OmniRoute

进行二次开发。

重点增强：

- Cloudflare 一键部署
- 渠道余额查看
- 套餐管理
- 更简单的用户体验


还有cc-switch 

---

# 6. MVP范围


第一阶段：

✅ Cloudflare 一键部署  
✅ 多渠道接入  
✅ OpenAI Compatible API  
✅ 模型统一管理  
✅ 模型路由  
✅ API Key 管理  
✅ 基础使用看板  




