# MVP 技术架构：Cloudflare AI Aggregation Gateway

> 对应产品范围：[README.md](../README.md) 的 MVP v0.1
>
> 文档状态：实现基线
>
> 架构目标：用最少的 Cloudflare 组件完成可部署、可调用、可回退、可观测的单管理员 AI 网关。

## 1. 范围与架构决策

### 1.1 MVP 支持范围

MVP 只支持：

- 单个 Cloudflare Worker；
- Worker Static Assets 管理后台；
- 一个 D1 数据库；
- 单管理员用户名密码登录与首次强制改密；
- OpenAI 官方及 OpenAI Compatible 渠道；
- OpenAI Chat Completions；
- `/v1/models` 兼容模型列表；
- 固定优先级路由；
- 响应开始前的跨渠道 Fallback；
- 流式和非流式用量尽力采集；
- D1 分钟级基础统计。

### 1.2 已确定的关键决策

| 决策 | MVP 选择 | 原因 |
|---|---|---|
| 前端部署 | Worker Static Assets | Deploy Button 不需要再部署 Pages，避免跨域和双应用配置 |
| 管理认证 | D1 单管理员 + 签名 Session Cookie | 初始凭据自动生成，登录后使用可修改的用户名密码 |
| Provider 协议 | OpenAI Chat Completions | 缩小 Provider 和 SSE 兼容矩阵 |
| 渠道指定 | 全局唯一完整别名 | 避免仅按 prefix 查询导致歧义 |
| 路由 | 保存后的固定顺序 | 行为稳定、容易解释和测试 |
| 同渠道重试 | 不自动重试 | 避免重复生成和重复计费 |
| Fallback | 仅响应提交前 | 流式响应提交后无法透明切换 Provider |
| 套餐和价格 | 手工填写、仅展示 | Provider 余额、费用和 Token 套餐不是同一种数据 |
| 用量 | 每请求直接 UPSERT 分钟表 | 不引入原始日志表和额外聚合任务 |
| Prompt/Response | 不持久化 | 降低隐私和存储风险 |

### 1.3 MVP 不解决的问题

- Claude、Gemini 和 OpenAI Responses 协议；
- 跨协议转换；
- 自动余额、套餐和价格同步；
- 动态成本路由和套餐路由；
- 流中断后的 Fallback；
- 多用户、RBAC、Key 级权限和限流；
- 高吞吐统计平台和精确账单。

## 2. 总体架构

### 2.0 Cloudflare 组件

只用 5 类组件：**1 个 Worker（含 Static Assets）+ 1 个 D1 + 2 个首次部署 Secrets + 1 个 Cron**。不用 Pages / KV / R2 / Durable Objects / Queues / GitHub Actions。

| 组件 | 用途 | 免费档限制 |
|---|---|---|
| Cloudflare Worker | 网关 API + 管理 API + 静态资源 | 10ms CPU / 请求 |
| D1 数据库（mygateway-db） | 配置、加密密钥、分钟级用量统计 | 5M 读 / 100k 写 / 天 |
| Worker Secrets（INITIAL_ADMIN_PASSWORD / MASTER_KEY） | 首次登录凭证 + Provider Key/Session 加密签名根密钥 | — |
| Cron（每日 03:17） | 清理 30 天前用量 | — |
| workers.dev 子域名 | 部署后访问入口 | 100k 请求 / 天 |

### 2.1 架构图

```text
  浏览器 / OpenAI SDK
        │
        ▼
  workers.dev ──────▶ Cloudflare Worker (mygatewaydemo)
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
 Static Assets       /admin/api/*           /v1/*
 SolidJS 管理后台    Session Cookie 认证     Gateway Key 认证
 (登录/渠道/模型/     Channels/Models/Keys   Model Resolver
  Keys/看板)          CRUD + Usage 查询      Fixed Router + Fallback
        │                    │                    │
        └──────────┬─────────┴─────┬──────────────┘
                   │               │
              D1 数据库        AI Provider
             (8 张表: 配置、     (OpenAI Compatible:
              密钥、用量)        DeepSeek/OpenAI 等)

  Secrets: INITIAL_ADMIN_PASSWORD（固定初始值）+ MASTER_KEY（随机生成）
  Cron: 每日 03:17 清理 30 天前用量
```

### 2.2 请求安全边界

```text
/admin/*      使用管理员 Session Cookie，不接受 Gateway Key 代替管理认证
/v1/*         使用 Gateway Bearer Key，不接受管理员 Cookie 代替调用认证
/health       无认证，只返回非敏感存活信息
静态资源       无认证；页面可加载，但管理数据必须经过 /admin/api/* 认证
```

### 2.3 为什么不使用 Pages

Deploy to Cloudflare Button 当前只部署 Workers 应用。把 SolidJS 构建结果作为 Worker Static Assets 可以：

- 用一个应用完成部署；
- 自动绑定 D1；
- 管理页面和 API 使用同源 Cookie；
- 消除 Pages → Worker 的 CORS 和 Access Cookie 问题；
- 简化自定义域和回滚。

## 3. 项目结构与模块边界

```text
mygateway/
├── src/
│   ├── index.ts                    # Worker 入口和顶层路由（/health /v1/* /admin/api/* /静态资源）
│   ├── env.ts                      # Env 类型和启动配置校验（parseConfig）
│   ├── http/
│   │   ├── errors.ts               # OpenAI 风格错误响应
│   │   ├── headers.ts              # Header 清洗和响应 Header
│   │   ├── request-id.ts           # Gateway Request ID
│   │   └── body-limit.ts           # 请求体大小限制
│   ├── auth/
│   │   ├── password.ts             # PBKDF2 密码摘要、验证和凭据规则
│   │   ├── admin-session.ts        # Session Cookie 签发/校验与版本失效
│   │   └── gateway-key.ts          # Gateway Key hash 验证（SHA-256）
│   ├── crypto/
│   │   └── provider-key.ts         # Provider Key AES-256-GCM 加解密
│   ├── cache/
│   │   └── ttl-lru.ts              # 有容量上限的 isolate 内存 TTL/LRU 缓存
│   ├── admin/
│   │   ├── router.ts               # /admin/api/* 路由 + Session 鉴权
│   │   ├── channels.ts             # 渠道 CRUD + 连接测试
│   │   ├── models.ts               # 模型卡片/实例 CRUD + 排序
│   │   ├── keys.ts                 # Gateway Key CRUD + 重新生成
│   │   ├── usage.ts                # 用量查询（今日/7天/30天）
│   │   └── system.ts               # 系统状态 + Provider 预设
│   ├── gateway/
│   │   ├── hono.ts                 # /v1/* Hono + OpenAPI 路由 + Bearer 鉴权中间件
│   │   ├── access-resolver.ts      # Key 鉴权 + 模型路由单次 D1 batch 与软缓存
│   │   ├── chat-completions.ts     # Chat Completions 代理（含 Fallback + 用量采集）
│   │   ├── models-list.ts          # /v1/models 列表
│   │   └── fallback-policy.ts      # 上游错误分类（可回退/不可回退）
│   ├── streaming/
│   │   └── sse-decoder.ts          # SSE 增量解析 + 流式 usage 提取
│   ├── db/
│   │   ├── admin-users.ts          # 单管理员账号读写
│   │   ├── channels.ts             # 渠道表操作
│   │   ├── models.ts               # 模型卡片/实例/标识符表操作
│   │   ├── keys.ts                 # Gateway Key 表操作
│   │   └── usage.ts                # 分钟级用量 UPSERT + 查询 + 清理
│   └── shared/
│       ├── ids.ts                  # ID / 时间戳生成
│       └── log.ts                  # 结构化日志（不含密钥/Prompt）
├── dashboard/
│   ├── src/
│   │   ├── index.tsx               # 入口 + 路由 + 鉴权守卫
│   │   ├── presets.ts              # Provider 预设（DeepSeek/OpenAI/...）
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── ChangeCredentials.tsx # 首次/日常修改管理员凭据
│   │   │   ├── Dashboard.tsx       # Gateway 端点 + 用量看板
│   │   │   ├── Channels.tsx        # 渠道管理（预设添加）
│   │   │   ├── Models.tsx          # 模型卡片 + 实例管理
│   │   │   ├── ApiKeys.tsx
│   │   │   └── System.tsx
│   │   └── app.css
│   └── vite.config.ts
├── e2e/
│   ├── helpers.ts                  # 测试工具（登录/重置/环境变量读取）
│   ├── journey.spec.ts             # UI 旅程测试（10 例，无外部依赖）
│   └── realtime.spec.ts            # 真实 DeepSeek 集成测试（7 例）
├── migrations/
│   ├── 0001_initial.sql            # 网关配置、密钥和用量表
│   └── 0002_admin_users.sql        # 管理员账号表
├── .dev.vars.example              # 本地开发环境变量模板（含说明注释）
├── wrangler.jsonc                 # Worker 配置（生产 auto-provision D1）
├── playwright.config.ts           # E2E 测试配置
└── package.json
```

### 3.1 模块依赖规则

- `admin/*` 和 `gateway/*` 可以调用 `db/*`、`crypto/*`、`usage/*`；
- `providers/*` 不直接访问 D1；
- `streaming/*` 不知道管理员和页面逻辑；
- `db/*` 只返回领域对象，不返回 HTTP Response；
- Provider 错误先归一化为内部错误分类，再由网关决定是否 Fallback；
- 所有日志通过统一的安全日志函数输出，禁止直接记录 Request、Header 或完整 body。

## 4. 运行配置

### 4.1 Worker Bindings 和 Secrets

```typescript
interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  // 初始管理员账号；密码 Secret 由首次部署脚本生成。
  INITIAL_ADMIN_USERNAME?: string;
  INITIAL_ADMIN_PASSWORD?: string;

  // 旧版升级首次登录兼容，完成改密后不再使用。
  ADMIN_TOKEN?: string;

  // 32 字节随机密钥的 base64 编码，用于 Provider Key AES-GCM。
  MASTER_KEY: string;

  APP_VERSION?: string;
  DEFAULT_TIMEZONE?: string;
  MAX_REQUEST_BYTES?: string;
  MAX_CHANNEL_ATTEMPTS?: string;
  UPSTREAM_HEADER_TIMEOUT_MS?: string;
  USAGE_RETENTION_DAYS?: string;
}
```

### 4.2 默认值

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `DEFAULT_TIMEZONE` | `Asia/Shanghai` | “今日”看板边界；可在系统设置覆盖 |
| `MAX_REQUEST_BYTES` | `2097152` | 2 MiB，请求超限返回 413 |
| `MAX_CHANNEL_ATTEMPTS` | `3` | 统一模型单请求最多尝试渠道数 |
| `UPSTREAM_HEADER_TIMEOUT_MS` | `30000` | 等待每个上游响应 Header 的超时 |
| `USAGE_RETENTION_DAYS` | `30` | 分钟统计保留时间 |

启动时必须校验：

- `MASTER_KEY` 解码后恰好 32 字节；
- 数值配置在允许范围内；
- 生产环境缺失关键 Secret 时返回明确的系统配置错误，不带 Secret 内容。

## 5. D1 数据模型

### 5.1 设计原则

- 所有 ID 使用 UUID；
- 时间统一存 Unix seconds；
- 渠道和模型使用软删除，保证历史统计仍可关联；
- Gateway Key 只存 hash；
- Provider Key 存 AES-GCM 密文、IV 和密钥版本；
- 价格使用整数微单位，不使用浮点数作为货币真值；
- usage 为分钟级聚合，不保存 Prompt/Response；
- 统一模型 ID 和完整公开别名通过统一标识符注册表保证全局不冲突。

### 5.2 初始 Schema

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL
    CHECK (provider_type IN ('openai', 'openai_compatible')),
  base_url TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  api_key_iv TEXT NOT NULL,
  api_key_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);

CREATE INDEX idx_channels_status
  ON channels(status)
  WHERE deleted_at IS NULL;

CREATE TABLE model_cards (
  id TEXT PRIMARY KEY,
  unified_model_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);

CREATE TABLE channel_models (
  id TEXT PRIMARY KEY,
  model_card_id TEXT NOT NULL REFERENCES model_cards(id),
  channel_id TEXT NOT NULL REFERENCES channels(id),
  channel_model_id TEXT NOT NULL,
  public_model_alias TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  supports_stream_usage INTEGER NOT NULL DEFAULT 0
    CHECK (supports_stream_usage IN (0, 1)),

  input_price_micros_per_million INTEGER,
  output_price_micros_per_million INTEGER,
  currency TEXT CHECK (currency IS NULL OR length(currency) = 3),

  plan_tokens_total INTEGER CHECK (plan_tokens_total IS NULL OR plan_tokens_total >= 0),
  plan_tokens_remaining INTEGER CHECK (plan_tokens_remaining IS NULL OR plan_tokens_remaining >= 0),
  plan_expires_at INTEGER,
  manual_metadata_updated_at INTEGER,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,

  UNIQUE(model_card_id, channel_id)
);

CREATE INDEX idx_channel_models_card_order
  ON channel_models(model_card_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_channel_models_channel
  ON channel_models(channel_id)
  WHERE deleted_at IS NULL;

-- 统一模型 ID 和完整公开别名共享同一个全局命名空间。
-- 相关模型和实例的创建、更新、软删除必须与本表变更放在同一 D1 batch 中。
CREATE TABLE model_identifiers (
  identifier TEXT PRIMARY KEY,
  identifier_type TEXT NOT NULL
    CHECK (identifier_type IN ('unified', 'alias')),
  model_card_id TEXT NOT NULL REFERENCES model_cards(id),
  channel_model_id TEXT REFERENCES channel_models(id),
  CHECK (
    (identifier_type = 'unified' AND channel_model_id IS NULL)
    OR
    (identifier_type = 'alias' AND channel_model_id IS NOT NULL)
  )
);

CREATE INDEX idx_model_identifiers_card
  ON model_identifiers(model_card_id);

CREATE TABLE gateway_api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER
);

CREATE TABLE usage_minutes (
  timestamp_minute INTEGER NOT NULL,
  model_card_id TEXT NOT NULL REFERENCES model_cards(id),
  channel_id TEXT NOT NULL REFERENCES channels(id),

  unified_model_id_snapshot TEXT NOT NULL,
  channel_name_snapshot TEXT NOT NULL,

  request_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  cancelled_count INTEGER NOT NULL DEFAULT 0,
  fallback_count INTEGER NOT NULL DEFAULT 0,
  attempt_count_total INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  usage_unknown_count INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (timestamp_minute, model_card_id, channel_id)
);

CREATE INDEX idx_usage_minutes_time
  ON usage_minutes(timestamp_minute);

CREATE INDEX idx_usage_minutes_model_time
  ON usage_minutes(model_card_id, timestamp_minute);

CREATE INDEX idx_usage_minutes_channel_time
  ON usage_minutes(channel_id, timestamp_minute);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER
);
```

### 5.3 数据约束说明

#### 统一模型 ID 和别名

`model_cards.unified_model_id` 与 `channel_models.public_model_alias` 分别保留各自的唯一约束，同时把两类 ID 写入 `model_identifiers.identifier`。其主键负责保证它们共享同一个全局命名空间：

```text
unified 模型 → identifier_type=unified，channel_model_id=NULL；
渠道别名   → identifier_type=alias，channel_model_id=对应实例 ID。
```

创建、重命名和软删除模型/实例时，领域表与注册表变更必须放在同一个 D1 batch 中；任一语句失败则整批回滚。路由解析始终使用完整字符串精确匹配，不做前缀猜测。

#### 删除策略

- 删除渠道：如果仍有未删除模型实例引用则返回 `409`；否则写入 `deleted_at`；
- 删除模型卡片：在同一 batch 中删除相关 identifier、软删除其所有实例并软删除卡片；
- 删除模型实例：在同一 batch 中删除 alias identifier 并写入 `deleted_at`；
- 历史 usage 不删除，依靠 snapshot 字段显示历史名称；
- 30 天保留策略只清理 `usage_minutes`。

#### 用量写入成本

每个完成的客户端请求至少执行一次 usage UPSERT。分钟粒度只减少表中唯一行数量，不减少请求期间的 UPDATE 次数。新增分钟行还会写入相关索引，因此容量测试必须使用 D1 返回的 `rows_written` 实测。

### 5.4 关键查询

Gateway Key 认证：

```sql
SELECT id, name
FROM gateway_api_keys
WHERE key_hash = ?
  AND status = 'active'
  AND revoked_at IS NULL
LIMIT 1;
```

模型标识符与候选渠道通过一条 LEFT JOIN 查询解析。LEFT JOIN 会在所有候选停用时保留标识符行，用于区分“不存在”和“暂不可用”：

```sql
SELECT
  mi.identifier_type,
  mi.model_card_id,
  mi.channel_model_id AS direct_channel_model_id,
  cm.id AS channel_model_id_pk,
  cm.channel_model_id,
  cm.public_model_alias,
  cm.sort_order,
  cm.supports_stream_usage,
  c.id AS channel_id,
  c.name AS channel_name,
  c.provider_type,
  c.base_url,
  c.api_key_ciphertext,
  c.api_key_iv,
  c.api_key_version
FROM model_identifiers mi
JOIN model_cards mc
  ON mc.id = mi.model_card_id
LEFT JOIN channel_models cm
  ON cm.model_card_id = mi.model_card_id
 AND mc.status = 'active'
 AND mc.deleted_at IS NULL
 AND cm.status = 'active'
 AND cm.deleted_at IS NULL
 AND (mi.identifier_type = 'unified' OR cm.id = mi.channel_model_id)
LEFT JOIN channels c
  ON c.id = cm.channel_id
 AND c.status = 'active'
 AND c.deleted_at IS NULL
WHERE mi.identifier = ?
ORDER BY cm.sort_order ASC, cm.id ASC;
```

正常 Chat 请求在缓存全未命中时，将 Gateway Key 查询与上述路由查询放入同一个 `DB.batch()`，只产生一次 D1 网络往返。命中 isolate 内存缓存时不访问 D1。

分钟用量 UPSERT：

```sql
INSERT INTO usage_minutes (
  timestamp_minute,
  model_card_id,
  channel_id,
  unified_model_id_snapshot,
  channel_name_snapshot,
  request_count,
  success_count,
  error_count,
  cancelled_count,
  fallback_count,
  attempt_count_total,
  input_tokens,
  output_tokens,
  usage_unknown_count
) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(timestamp_minute, model_card_id, channel_id) DO UPDATE SET
  request_count = request_count + 1,
  success_count = success_count + excluded.success_count,
  error_count = error_count + excluded.error_count,
  cancelled_count = cancelled_count + excluded.cancelled_count,
  fallback_count = fallback_count + excluded.fallback_count,
  attempt_count_total = attempt_count_total + excluded.attempt_count_total,
  input_tokens = input_tokens + excluded.input_tokens,
  output_tokens = output_tokens + excluded.output_tokens,
  usage_unknown_count = usage_unknown_count + excluded.usage_unknown_count;
```

保留数据清理：

```sql
DELETE FROM usage_minutes
WHERE timestamp_minute < ?;
```

清理操作本身也消耗行写额度。Cron 应每天执行一次，并记录受影响行数。

## 6. 认证和密钥安全

### 6.1 管理员认证

登录接口：

```http
POST /admin/api/auth/login
Content-Type: application/json

{"username":"admin","password":"<INITIAL_ADMIN_PASSWORD>"}
```

处理流程：

1. 首次部署设置初始用户名 `admin` 和固定初始密码 `mygateway123`；
2. 第一次成功登录时，在 D1 创建单管理员记录；
3. 密码使用随机 16 字节盐和 PBKDF2-HMAC-SHA256（100,000 次，Cloudflare Workers 运行时上限）保存摘要；
4. 初始账号标记 `must_change_password`，修改凭据前拒绝其他管理 API；
5. 生成包含用户 ID、Session 版本、过期时间和 nonce 的 Session payload；
6. 使用从 `MASTER_KEY` 经独立 HKDF domain 派生的 HMAC-SHA256 密钥签名；
7. 写入 `mg_admin_session` Cookie，默认有效期 8 小时；
8. 修改用户名或密码时递增 Session 版本，使其他旧 Session 失效。

Cookie：

```text
HttpOnly
Secure
SameSite=Strict
Path=/
```

所有修改型管理 API 还必须检查 `Origin` 与当前请求 origin 一致，降低 CSRF 和跨站请求风险。

管理员密码明文不写入 D1。旧部署可用原 `ADMIN_TOKEN` 作为一次性初始密码，首次改密后不再依赖该 Secret。

### 6.2 Gateway API Key

生成：

```text
gw_ + base64url(randomBytes(32))
```

存储：

- `key_hash = hex(SHA-256(full_key))`；
- `key_prefix` 只保存足够识别的前几位；
- 明文只在创建/重新生成响应中出现一次；
- 重新生成采用“创建新 hash + 撤销旧 hash”的原子操作。

认证失败统一返回 OpenAI 风格 `401`，不区分 Key 不存在、停用或已撤销。

### 6.3 Provider API Key 加密

`MASTER_KEY` 是 base64 编码的 32 字节随机值。每个 Provider Key：

1. 生成随机 12 字节 IV；
2. 使用 AES-256-GCM 加密；
3. Additional Authenticated Data 使用 `channel:<channel_id>:v<key_version>`；
4. D1 保存 ciphertext、IV 和 key version；
5. 仅在即将构造上游请求时解密；
6. 解密后的字符串不进入领域对象的调试输出。

Schema 保留 `api_key_version` 以支持后续主密钥轮换。MVP 不提供在线轮换 UI，但实现不得把版本写死在解密函数外。

### 6.4 日志脱敏规则

禁止记录：

- `Authorization`；
- Cookie；
- 管理员初始密码、密码明文和摘要；
- `MASTER_KEY`；
- Gateway Key；
- Provider Key、密文和 IV；
- Prompt、Response 正文和完整请求 body。

允许记录：

- Gateway Request ID；
- API Key 数据库 ID；
- 模型卡片 ID、统一模型 ID；
- 渠道 ID 和名称；
- 上游状态码和 Provider request ID；
- 尝试次数、Fallback 分类和耗时；
- usage 数值和是否未知。

## 7. HTTP 路由与统一错误

### 7.1 顶层路由

```text
POST /admin/api/auth/login       无管理 Session
GET  /health                    无认证
/admin/api/*                    校验管理 Session
/v1/*                           校验 Gateway Key
其他 API 路径                   404
其他 GET/HEAD                   env.ASSETS.fetch(request)
```

### 7.2 Gateway 错误格式

使用 OpenAI 风格错误体：

```json
{
  "error": {
    "message": "No active channel is available for model 'deepseek-chat'.",
    "type": "gateway_error",
    "param": "model",
    "code": "model_unavailable"
  }
}
```

关键错误映射：

| HTTP | code | 场景 |
|---:|---|---|
| 400 | `invalid_request` | JSON、model 或参数无效 |
| 401 | `invalid_api_key` | Gateway Key 无效 |
| 404 | `model_not_found` | 统一模型或完整别名不存在 |
| 409 | `resource_in_use` | 删除被模型引用的渠道 |
| 413 | `request_too_large` | 请求超过大小限制 |
| 429 | `gateway_rate_limited` | 后续网关限流预留；MVP 通常不产生 |
| 503 | `model_unavailable` | 模型存在但没有启用实例 |
| 502 | `upstream_error` | 指定渠道失败或不可回退错误 |
| 504 | `upstream_timeout` | 所有候选等待响应 Header 超时 |
| 500 | `gateway_internal_error` | 未预期内部错误 |

所有响应增加：

```http
x-gateway-request-id: <uuid>
```

## 8. Chat Completions 请求流程

### 8.1 完整流程

```text
POST /v1/chat/completions
    │
    ├─ 1. 生成 Gateway Request ID
    ├─ 2. 提取并 hash Gateway Bearer Key
    ├─ 3. 限制并读取 JSON body，校验 model/messages
    ├─ 4. 查询 isolate 内存中的 Key/路由 TTL 缓存
    ├─ 5. 缓存未命中：一次 D1 batch 完成鉴权和候选解析
    ├─ 6. 缓存命中：不访问 D1；按统一模型/完整别名确定候选
    ├─ 7. 逐候选构造并发送上游请求
    │      ├─ 响应前可回退错误 → 下一候选
    │      └─ 接受响应 → 锁定最终渠道
    ├─ 8a. 非流式：tee 响应，异步解析 usage，透传客户端
    ├─ 8b. 流式：创建可取消 ReadableStream，解析 SSE usage
    └─ 9. 流/响应结束后异步 UPSERT usage
```

### 8.2 请求校验

要求：

- Method 必须为 POST；
- Content-Type 必须为 `application/json`；
- body 必须是 JSON object；
- `model` 必须是非空字符串且不超过 128 字符；
- `messages` 必须是数组；
- `stream` 缺省为 false，存在时必须是 boolean；
- 请求体不得超过 `MAX_REQUEST_BYTES`；
- 网关不在 MVP 中验证所有可选 OpenAI 字段，由上游继续做协议校验。

### 8.3 模型解析顺序

统一模型 ID 与完整别名通过 `model_identifiers` 共享全局命名空间。解析时：

1. 用请求中的 `model` 精确查询 `model_identifiers.identifier`；
2. 未命中返回 404；
3. `identifier_type=unified` 时，按 `model_card_id` 查询并排序所有可用候选；
4. unified 标识符命中但无可用实例时返回 503；
5. `identifier_type=alias` 时，只查询 `channel_model_id` 对应的一个可用实例；
6. alias 命中后标记 `direct=true`，禁止跨渠道 Fallback；
7. 标识符存在但其领域记录已停用或软删除时返回 503，并记录数据一致性告警。

### 8.4 `/v1/models`

返回所有已启用统一模型和可用完整别名：

```json
{
  "object": "list",
  "data": [
    {
      "id": "deepseek-chat",
      "object": "model",
      "created": 0,
      "owned_by": "mygateway"
    },
    {
      "id": "ds-deepseek-chat",
      "object": "model",
      "created": 0,
      "owned_by": "mygateway"
    }
  ]
}
```

模型列表不调用上游 `/models`，只反映管理员配置。

## 9. Provider Adapter 和上游请求

### 9.1 Adapter 接口

MVP 只有一个 OpenAI Compatible Adapter，但保留明确接口：

```typescript
interface ProviderAdapter {
  buildChatCompletionsUrl(baseUrl: URL): URL;
  buildHeaders(input: {
    clientHeaders: Headers;
    providerApiKey: string;
    requestId: string;
  }): Headers;
  prepareChatBody(input: {
    originalBody: Record<string, unknown>;
    channelModelId: string;
    supportsStreamUsage: boolean;
  }): Record<string, unknown>;
  classifyError(response: Response, bodyPreview?: string): UpstreamErrorKind;
  parseNonStreamUsage(body: unknown): Usage | null;
}
```

后续 Claude/Gemini 扩展必须实现独立 Adapter，不能继续假设统一 Bearer Header 和统一 SSE 事件。

### 9.2 Base URL 语义

管理员填写的是 OpenAI API 根路径，包含版本路径：

```text
https://api.openai.com/v1
https://provider.example.com/openai/v1
```

创建渠道时：

- 只接受 `https:`；
- 禁止 username/password；
- 禁止 query 和 fragment；
- 移除末尾 `/` 后存储；
- 上游 Chat URL 为 `<base_url>/chat/completions`；
- 测试模型 URL 为 `<base_url>/models`。

不能只替换客户端 URL 的 hostname，因为兼容渠道可能包含端口或路径前缀。

### 9.3 请求 Header 重建

上游 Header 从空集合开始构造，不复制整个客户端 Header。

固定设置：

```http
Authorization: Bearer <provider-key>
Content-Type: application/json
Accept: application/json 或 text/event-stream
User-Agent: mygateway/<version>
x-gateway-request-id: <request-id>
```

可选透传经过白名单验证的追踪 Header。禁止转发：

- 客户端 `Authorization`；
- Cookie；
- Host、Content-Length；
- `cf-*`、`x-forwarded-*`；
- `x-api-key`；
- Access JWT；
- 浏览器特有和 hop-by-hop Header。

### 9.4 请求体改写

```typescript
const upstreamBody = structuredClone(originalBody);
upstreamBody.model = candidate.channelModelId;

if (upstreamBody.stream === true && candidate.supportsStreamUsage) {
  upstreamBody.stream_options = {
    ...(isObject(upstreamBody.stream_options) ? upstreamBody.stream_options : {}),
    include_usage: true,
  };
}
```

使用 JSON parse/serialize，不使用正则替换 `model`，避免嵌套字段、转义和恶意输入导致错误替换。

## 10. 路由和 Fallback 状态机

### 10.1 候选选择

统一模型：

```text
所有启用实例
  → 过滤已停用/软删除渠道
  → sort_order 升序
  → 同序按实例 ID 稳定排序
  → 截取 MAX_CHANNEL_ATTEMPTS
```

完整别名：

```text
精确匹配一个启用实例
  → candidates = [target]
  → direct = true
```

### 10.2 请求状态

```text
RESOLVING
  → ATTEMPTING(candidate N)
      → RETRYABLE_PRE_RESPONSE_ERROR → ATTEMPTING(candidate N+1)
      → FINAL_PRE_RESPONSE_ERROR     → RETURN_ERROR
      → RESPONSE_ACCEPTED
          → NON_STREAM_FORWARDING → COMPLETE
          → STREAM_FORWARDING
              → COMPLETE
              → STREAM_ERROR
              → CLIENT_CANCELLED
```

进入 `RESPONSE_ACCEPTED` 后渠道被锁定，不再执行 Fallback。

### 10.3 错误分类

| 错误 | 统一模型 | 完整别名 | 说明 |
|---|---|---|---|
| DNS/TLS/连接失败 | 下一渠道 | 直接返回 | fetch 抛出网络错误 |
| 等待 Header 超时 | 下一渠道 | 直接返回 | 每候选独立超时 |
| 408 | 下一渠道 | 原样/归一化返回 | 上游请求超时 |
| 429 | 下一渠道 | 原样返回 | MVP 不等待 Retry-After |
| 500/502/503/504 | 下一渠道 | 原样返回 | Provider 服务错误 |
| 明确额度不足 | 下一渠道 | 原样返回 | 仅识别可靠状态/错误码 |
| 普通 400 | 直接返回 | 直接返回 | 客户端请求无效，多渠道重试无意义 |
| 内容安全拒绝 | 直接返回 | 直接返回 | 不规避 Provider 安全判断 |
| 200 后 SSE error | 终止流 | 终止流 | 已提交响应，不能回退 |
| 客户端取消 | 终止上游 | 终止上游 | 不继续消耗渠道 |

### 10.4 超时与取消

- 每个候选使用独立 AbortController；
- `UPSTREAM_HEADER_TIMEOUT_MS` 只控制等待 `fetch()` 返回响应 Header；
- 一旦接受流式响应，不使用同一个 Header timeout 中止长生成；
- 客户端取消时调用上游 reader.cancel，并触发该候选 AbortController；
- 最多尝试 `MAX_CHANNEL_ATTEMPTS` 个候选；
- MVP 不在同一候选上原地重试。

### 10.5 最终错误

- 如果存在不可回退错误，直接返回该上游错误；
- 如果所有候选都是超时，返回 504；
- 如果所有候选均为可回退上游错误，返回最后一次上游错误，并增加 Gateway Request ID；
- 错误 body 读取设置上限，避免超大错误响应消耗内存；
- 日志记录每次尝试，但 usage 分钟表只按最终渠道汇总一次客户端请求。

## 11. 非流式响应和用量

### 11.1 响应处理

接受成功的非流式响应后，将 body `tee()`：

```text
upstream response.body
  ├── branch A → 立即返回客户端
  └── branch B → 解析 JSON usage → 写入 D1
```

branch B 的解析和 D1 写入通过 `ctx.waitUntil()` 执行。解析失败：

- 不影响 branch A；
- 记录 `usage_unknown=1`；
- 输出不含 body 的结构化警告。

### 11.2 Usage 映射

```typescript
type Usage = {
  inputTokens: number;
  outputTokens: number;
};
```

OpenAI Chat Completions：

```text
usage.prompt_tokens     → inputTokens
usage.completion_tokens → outputTokens
```

字段缺失、非整数或负数时视为 usage 未知，不做推断。

## 12. SSE 流式转发

### 12.1 为什么不能按网络 chunk 解析

网络 chunk 与 SSE event 没有一一对应关系：

- 一个 JSON event 可能被拆成多个 chunk；
- 一个 chunk 可能包含多个 event；
- UTF-8 多字节字符可能跨 chunk；
- `[DONE]` 可能和前一个事件位于同一 chunk。

因此需要增量 SSE Decoder。

### 12.2 SSE Decoder

Decoder 维护：

- 流式 `TextDecoder`；
- 未完成文本 buffer；
- 当前 event 的 `event:` 和多行 `data:`；
- 最后一个有效 usage；
- 是否看到 `[DONE]`；
- 是否发生解析错误。

Decoder 只旁路观察，不改变转发字节。解析失败后：

- 继续原样透传；
- 禁用后续 usage 解析；
- 最终记录 usage 未知。

### 12.3 可取消代理流

使用自定义 `ReadableStream` 包装上游 reader：

```typescript
const clientStream = new ReadableStream({
  async pull(controller) {
    const result = await upstreamReader.read();
    if (result.done) {
      await finalizeUsage();
      controller.close();
      return;
    }

    usageDecoder.observe(result.value);
    controller.enqueue(result.value);
  },

  async cancel(reason) {
    upstreamAbortController.abort(reason);
    await upstreamReader.cancel(reason);
    await finalizeCancelledUsage();
  },
});
```

实际实现必须保证 finalize 幂等，`complete`、`error`、`cancel` 只能有一个终态写入。

### 12.4 流式 usage

只有实例配置 `supports_stream_usage=1` 时，网关才注入 `include_usage=true`。

有效的最终 usage chunk：

- `usage` 是对象；
- `prompt_tokens`、`completion_tokens` 是非负整数；
- 通常 `choices` 为空，但解析器不依赖这一点；
- `[DONE]` 不包含 usage。

以下情况记录 `usage_unknown=1`：

- Provider 不支持流式 usage；
- 未收到最终 usage；
- 客户端取消；
- 上游中断；
- SSE 或 JSON 解析失败。

## 13. 用量采集

### 13.1 请求级上下文

```typescript
interface UsageContext {
  requestId: string;
  modelCardId: string;
  unifiedModelId: string;
  finalChannelId: string;
  finalChannelName: string;
  attemptCount: number;
  fallbackOccurred: boolean;
  outcome: 'success' | 'error' | 'cancelled';
  usage: Usage | null;
  completedAt: number;
}
```

### 13.2 汇总语义

- 一次客户端请求只增加一次 `request_count`；
- `attempt_count_total` 增加实际上游尝试次数；
- `fallback_count` 表示该请求至少尝试过第二个渠道；
- 统计维度使用最终接受/最终失败的渠道；
- 前面失败候选的详情只进入结构化日志，不为每次尝试额外写 D1；
- 客户端取消增加 `cancelled_count` 和 `usage_unknown_count`；
- usage 缺失增加 `usage_unknown_count`，Token 增量为 0；
- Token 为 0 与 usage 未知通过 `usage_unknown_count` 区分。

### 13.3 写入失败

D1 统计失败时：

- 不修改已经返回给客户端的模型响应；
- 输出 `usage_write_failed` 结构化事件；
- MVP 不在请求内重试 D1 写入，避免增加 CPU 和写入放大。

### 13.4 看板查询

查询范围转换为 `[startMinute, endMinute)`，并使用参数化 SQL。

概览：

```sql
SELECT
  SUM(request_count) AS requests,
  SUM(success_count) AS successes,
  SUM(error_count) AS errors,
  SUM(cancelled_count) AS cancelled,
  SUM(fallback_count) AS fallbacks,
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(usage_unknown_count) AS usage_unknown
FROM usage_minutes
WHERE timestamp_minute >= ? AND timestamp_minute < ?;
```

按模型和渠道查询使用相同时间条件后 GROUP BY。管理 API 只允许 `today`、`7d`、`30d` 三个预设范围，防止任意超大扫描。

## 14. 管理 API

所有 JSON API：

- 使用 `Content-Type: application/json`；
- 返回 `x-gateway-request-id`；
- 修改请求校验管理 Session 和同源 Origin；
- 使用统一错误结构；
- 不返回 Provider Key 密文、IV 或 Gateway Key hash。

### 14.1 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/admin/api/auth/login` | 使用管理员用户名密码登录 |
| POST | `/admin/api/auth/logout` | 清除 Session Cookie |
| GET | `/admin/api/auth/session` | 查询用户名和首次改密状态 |
| POST | `/admin/api/auth/change-credentials` | 修改用户名密码并使旧 Session 失效 |

### 14.2 渠道

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/api/channels` | 列出渠道，不返回 Key 材料 |
| POST | `/admin/api/channels` | 创建渠道并加密 Provider Key |
| PUT | `/admin/api/channels/:id` | 更新名称、URL、状态、备注；Key 留空表示不修改 |
| DELETE | `/admin/api/channels/:id` | 无引用时软删除 |
| POST | `/admin/api/channels/:id/test` | 测试 `/models` 或最小调用 |

连接测试默认请求 `<base_url>/models`。请求体可选提供 `model`；提供时允许发送一次最小、非流式 Chat Completions 作为兼容性测试，并在 UI 中明确提示该测试可能产生少量 Token 费用。`/models` 返回 404 时只标记“模型列表接口不支持”，不自动判定 Chat Completions 一定不可用。

创建渠道请求：

```json
{
  "name": "DeepSeek",
  "provider_type": "openai_compatible",
  "base_url": "https://api.deepseek.com/v1",
  "api_key": "sk-...",
  "notes": "primary"
}
```

列表响应只显示：

```json
{
  "id": "...",
  "name": "DeepSeek",
  "provider_type": "openai_compatible",
  "base_url": "https://api.deepseek.com/v1",
  "has_api_key": true,
  "status": "active",
  "notes": "primary",
  "created_at": 0,
  "updated_at": 0
}
```

### 14.3 模型卡片和实例

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/api/models` | 模型卡片及实例列表 |
| POST | `/admin/api/models` | 创建模型卡片 |
| PUT | `/admin/api/models/:id` | 更新显示名和状态 |
| DELETE | `/admin/api/models/:id` | 软删除卡片和实例 |
| POST | `/admin/api/models/:id/instances` | 添加渠道实例 |
| PUT | `/admin/api/models/:id/instances/:instanceId` | 更新模型 ID、别名、状态和手工元数据 |
| DELETE | `/admin/api/models/:id/instances/:instanceId` | 软删除实例 |
| PUT | `/admin/api/models/:id/instances/reorder` | 原子重排实例 |

重排请求：

```json
{
  "instance_ids": ["instance-a", "instance-b", "instance-c"]
}
```

服务必须校验：

- 所有 ID 属于同一模型卡片；
- 没有重复或遗漏未删除实例；
- 在一个 D1 batch 中把顺序更新为 `0..n-1`。

### 14.4 Gateway Key

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/api/keys` | 列出名称、prefix 和状态 |
| POST | `/admin/api/keys` | 创建，返回一次明文 |
| PUT | `/admin/api/keys/:id` | 更新名称或状态 |
| POST | `/admin/api/keys/:id/regenerate` | 原子撤销旧 Key 并返回新明文 |
| DELETE | `/admin/api/keys/:id` | 撤销 Key |

### 14.5 用量和系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/api/usage/overview?range=today|7d|30d` | 概览 |
| GET | `/admin/api/usage/by-model?range=...` | 模型统计 |
| GET | `/admin/api/usage/by-channel?range=...` | 渠道统计 |
| GET | `/admin/api/usage/trend?range=...` | 趋势数据 |
| DELETE | `/admin/api/usage` | 显式确认后清除全部用量 |
| GET | `/admin/api/system/status` | 版本、D1 状态、配置状态 |
| GET | `/admin/api/system/settings` | 时区和保留天数 |
| PUT | `/admin/api/system/settings` | 更新非敏感设置 |

## 15. 管理前端

### 15.1 技术栈

- SolidJS；
- TypeScript；
- Vite；
- TailwindCSS；
- 原生 HTML5 Drag & Drop 或确认维护状态良好的 Solid 拖拽库；
- 轻量图表库，例如 uPlot。

### 15.2 页面行为

整体采用桌面控制台的左右结构：固定左侧导航、顶部页面状态区、浅灰工作区和白色大圆角内容卡片；窄屏时侧栏转换为横向导航。紫色只用于主操作、当前导航和关键数据，危险操作使用独立红色语义。

#### Login

- 不在 LocalStorage 保存管理员密码或 Session；
- 登录成功后依赖 HttpOnly Cookie；
- 首次登录强制进入凭据修改页；
- 401 自动回到登录页。

#### Channels

- Key 输入只用于创建/替换；
- 编辑页不显示密文或伪造的可复制 Key；
- 测试连接明确展示耗时、状态码和脱敏错误；
- 删除前显示模型引用关系。

#### Models

- 卡片内显示渠道、上游模型 ID、完整别名和固定顺序；
- 手工价格和套餐带“手工数据”标签和更新时间；
- 拖拽完成后一次提交完整 ID 顺序；
- 冲突的统一模型 ID/别名在提交前和服务端都校验。

#### API Keys

- 明文只在创建/重新生成弹窗展示一次；
- 离开弹窗后不可再次查看；
- 重新生成必须二次确认旧 Key 立即失效。

#### Dashboard

- today/7d/30d 三档；
- Token 未知单独展示；
- 不把手工价格乘 Token 后标为正式账单；
- 渠道统计代表最终渠道，不是全部失败尝试明细。

## 16. 部署设计

### 16.1 部署方式

支持两种方式，底层同一套流程：

1. **Deploy Button**（推荐）：`deploy.workers.cloudflare.com/?url=<repo>` → Cloudflare Git 集成自动完成构建与部署；
2. **本地 CLI**：`wrangler login` → `npm run deploy`，部署脚本自动初始化缺失的 Secrets。

实际配置见仓库根目录 `wrangler.jsonc` 与 `package.json`。关键点：

- 生产配置**不含 `database_id`** → `wrangler deploy` 时自动创建并绑定 D1；
- deploy 脚本顺序为 `build → deploy（provision D1）→ migrate → secrets:init`；
- `secrets:init` 只创建缺失的 `INITIAL_ADMIN_PASSWORD` 和 `MASTER_KEY`，绝不覆盖已有 Secret。

### 16.2 部署流程

```text
Deploy Button → 登录 Cloudflare + 授权 GitHub
  → 自动创建 Worker + D1
  → npm install → 构建前端 → wrangler deploy
  → 设置固定 INITIAL_ADMIN_PASSWORD，随机生成 MASTER_KEY 并显示一次
  → migrations 建 8 张表
  → 使用 admin + 初始密码登录并强制修改凭据
  → 打开控制台配置渠道、模型和 Gateway Key
```

仓库根目录提供 `.dev.vars.example` 模板：

```dotenv
INITIAL_ADMIN_PASSWORD=mygateway123
MASTER_KEY=
```

本地开发只需自行填写 `MASTER_KEY`；生产由首次部署脚本创建两个 Secret。不能把带真实密钥的 `.dev.vars` 提交到 Git。

### 16.3 Secret 生成说明

首次部署生成规则：

```text
INITIAL_ADMIN_PASSWORD：固定为 mygateway123，仅用于首次登录并强制修改
MASTER_KEY：恰好 32 字节随机值并进行 base64 编码
```

Secret 只能进入 Cloudflare Worker Secrets，不能写入 `wrangler.jsonc`、Git 仓库或前端构建变量。

随机生成的 `MASTER_KEY` 会在账号私有的部署日志中显示一次。用户必须在密码管理器中备份 `MASTER_KEY`，并在首次登录后立即修改公开的初始密码。如果意外替换 `MASTER_KEY`，已有 Provider Key 密文和管理 Session 都将失效；恢复方式是还原原 Master Key，或逐个重新填写 Provider Key。

## 17. Cron 任务

MVP 只使用一个每日 Cron：

```text
读取 USAGE_RETENTION_DAYS
  → 计算 UTC 截止分钟
  → DELETE 过期 usage_minutes
  → 记录删除行数和 D1 meta
```

Cron 不执行：

- Provider 余额查询；
- 模型同步；
- 价格抓取；
- 自动健康探测；
- 自动重排渠道。

## 18. Cloudflare 免费额度与降级

### 18.1 已知限制

| 项目 | Free 约束 | MVP 对策 |
|---|---:|---|
| Worker 请求 | 100,000/天 | 推荐使用量不超过 10,000/天 |
| Worker CPU | 10ms/请求 | 流式转发、有限 JSON 解析、实现后 CPU profile |
| Worker 子请求 | 50/请求 | 最多 3 个 Provider fetch，加少量 D1 查询 |
| 并发出站连接 | 6/请求 | 候选串行尝试，不并行广播 |
| D1 行读取 | 5,000,000/天 | 索引、单次 batch、短 TTL isolate 缓存 |
| D1 行写入 | 100,000/天 | 每客户端请求一次 usage UPSERT，实测索引写放大 |
| D1 大小 | 5GB（账号总计） | 只存配置和 30 天分钟聚合 |
| Workers Logs | 200,000 events/天、3 天保留 | 10% head sampling，只记录脱敏结构化事件 |

### 18.2 降级原则

- usage 写入失败：模型响应继续，记录统计错误；
- 看板查询失败：管理后台显示不可用，不影响 `/v1/*`；
- D1 配置查询失败：不能安全路由，网关返回 503；
- CPU 接近 Free 限制：优先减少旁路解析和日志，不能用正则替换 JSON 或放弃安全校验；
- 代表性负载仍超过 10ms：将 Workers Paid 列为运行要求。

### 18.3 D1 单点影响

D1 配置查询默认依赖数据库 primary。全球 Edge 不代表 D1 查询一定本地完成。当前数据面采用以下免费档优化：

- 正常 Chat 冷请求用一次 `DB.batch()` 完成 Key 鉴权和路由查询；
- 有效 Key 缓存 30 秒，无效 Key 缓存 5 秒，最多 1,000 条；
- 成功路由缓存 60 秒，不存在/不可用模型缓存 5 秒，最多 200 条；
- 缓存只保存 Key hash 的验证结果、路由配置和 Provider Key 密文，不保存任何原始 Key 明文；
- 管理 API 写入会清空当前 isolate 的相关缓存，其他 isolate 依靠 TTL 收敛；
- isolate 被回收或缓存淘汰时自动回源 D1，D1 始终是唯一权威数据源；
- 不引入 KV、Queues、Durable Objects，缓存本身不产生额外存储操作费用。

必须持续测量：

- 不同地区的 Gateway Key 查询延迟；
- 模型候选查询延迟；
- 加 D1 后的首字节增量；
- 缓存命中率和单次 batch 的首字节增量。

网关在响应中提供稳定的 `X-Gateway-Timing`，同时写入标准 `Server-Timing`，无需额外存储服务。Cloudflare 可能为 `cfWorker` 或 RUM 指标管理并覆盖标准头，生产排障应优先读取 `X-Gateway-Timing`：

- `gateway-cache`：`hit`、`partial` 或 `miss`；
- `gateway-access`：鉴权与路由解析耗时；
- `gateway-d1`：本次请求的 D1 batch 耗时，缓存全命中时为 `0`；
- `upstream-ttfb`：上游返回响应头的耗时；
- `gateway-ttfb`：网关准备好客户端响应头的总耗时。

Gateway Key 撤销在执行管理请求的当前 isolate 立即生效，跨 isolate 最长约 30 秒；渠道或模型停用跨 isolate 最长约 60 秒。需要全局即时失效时必须回到逐请求权威查询，或引入额外协调组件。

## 19. 可观测性

### 19.1 结构化事件

至少输出：

```text
gateway_request_started
gateway_auth_failed
gateway_access_resolved
model_resolved
upstream_attempt_started
upstream_attempt_failed
upstream_response_accepted
gateway_stream_completed
gateway_stream_cancelled
usage_write_failed
gateway_request_completed
admin_operation_failed
cron_cleanup_completed
```

`gateway_access_resolved` 记录 `cache_status`、`key_cache`、`model_cache`、
`d1_statements`、`d1_ms` 和 `access_ms`；`gateway_request_completed` 记录
`total_ms`、`upstream_ttfb_ms`、尝试次数及 Fallback。所有字段都不包含 Key、
Prompt 或 Response 正文。生产配置启用 Workers Logs 的 10% head sampling，
因此这些日志用于趋势和排障，不作为精确计费数据；完整请求计数仍以 D1 分钟聚合为准。

统一字段：

```typescript
interface LogEventBase {
  event: string;
  request_id?: string;
  timestamp: string;
  model_id?: string;
  channel_id?: string;
  attempt?: number;
  status?: number;
  duration_ms?: number;
  error_code?: string;
}
```

### 19.2 健康接口

```http
GET /health
```

响应：

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

`/health` 不查询 Provider，不返回渠道数量、D1 内容、Secret 状态或错误堆栈。需要深度诊断时使用已认证的 `/admin/api/system/status`。

## 20. 测试策略

### 20.1 单元测试

- 统一模型和完整别名精确解析；
- 跨类型 ID 冲突校验；
- 固定排序和启停过滤；
- direct alias 禁止 Fallback；
- HTTP/Provider 错误分类；
- AES-GCM round trip、错误 key 和错误 AAD；
- Gateway Key 生成和 hash；
- TTL/LRU 到期、容量淘汰和负缓存；
- Key 鉴权与模型路由冷请求单次 batch、热请求零 D1；
- Admin Session 过期、篡改和 Token 轮换；
- Header 白名单；
- Base URL 规范化；
- usage 数值校验。

### 20.2 SSE Fixture 测试

必须覆盖：

- 一个 event 分成多个 chunk；
- 一个 chunk 包含多个 event；
- 中文 UTF-8 跨 chunk；
- 多行 `data:`；
- 正常 usage + `[DONE]`；
- 没有 usage；
- JSON 损坏但字节仍透传；
- 上游中断；
- 客户端取消；
- finalize 只能写一次。

### 20.3 集成测试

- 本地 D1 migrations；
- 渠道 CRUD 和 Key 不回显；
- 模型实例和原子重排；
- Gateway Key 撤销在当前 isolate 立即清缓存，其他 isolate 在 30 秒内失效；
- 第一渠道 503、第二渠道成功；
- 第一渠道 400 不尝试第二渠道；
- 指定别名 503 不尝试第二渠道；
- 200 SSE 输出后 error 不尝试第二渠道；
- usage UPSERT 的 request/attempt/fallback 语义；
- 30 天清理边界。

### 20.4 部署与负载测试

- 在全新 Cloudflare Free 账号走一次 Deploy Button；
- 验证 D1 自动创建、migration 和 Static Assets；
- OpenAI SDK 流式/非流式 smoke test；
- 1KB、100KB、1MB 非流式响应；
- 长 SSE 输出和慢客户端；
- 1、2、3 候选 Fallback；
- 记录 P50/P95/P99 CPU、wall time、D1 rows read/write；
- 确认日志无 Prompt 和密钥。

## 21. 实现顺序

建议按以下顺序开发，每一步都形成可测试增量：

1. Worker 骨架、Static Assets、D1 migration 和 `/health`；
2. 管理 Token Session 和安全日志；
3. 渠道 CRUD、AES-GCM 和连接测试；
4. 模型卡片、实例、完整别名和排序；
5. Gateway API Key；
6. 非流式 Chat Completions 单渠道代理；
7. 统一模型固定路由和响应前 Fallback；
8. SSE 透传、取消和流式 usage；
9. usage_minutes 写入和看板查询；
10. 管理前端完整交互；
11. Deploy Button、Cron、负载与安全验收。

## 22. 上线前必须验证的假设

以下结论当前是架构预算，不是已经验证的事实：

- JSON 校验、AES-GCM、D1 查询和 SSE usage 解析可以稳定运行在 Free 10ms CPU 内；
- 每请求一次 usage UPSERT 在目标流量和索引下不会耗尽 D1 写额度；
- 目标 OpenAI Compatible 渠道支持所需 Chat 字段和 SSE 格式；
- Deploy Button 能正确生成两个首次 Secret、创建 D1 并执行 migration；
- `run_worker_first` 和 SPA fallback 配置与实现时的 Wrangler 版本一致；
- D1 primary 延迟对目标用户可接受。

这些项目必须通过测试结果关闭，不能仅凭估算在 README 中标记为已完成。
