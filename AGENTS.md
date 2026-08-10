# MyGateway Agent Guide

本文件是 AI Agent 在本仓库工作的入口。用户需求和仓库实际代码优先于本文；产品行为的
权威来源是 `docs/PRD.md`。

## 开始前

1. 运行 `git status --short --branch`，保留用户已有改动，不覆盖无关文件。
2. 阅读与任务直接相关的文档：产品改动先看 `docs/PRD.md`，协议 / Provider 改动再看
   `docs/DESIGN.md`，数据面改动看 `docs/ARCHITECTURE.md`。
3. 用 `rg` 定位实现与测试。不要依据 README 或旧 Changelog 猜测当前行为。

## 不可破坏的产品约束

- 默认部署保持 Cloudflare Free Tier 友好：Worker + Static Assets + D1 + Secrets + 单个 Cron。
- 不新增 KV、R2、Queues、Durable Objects 或外部服务，除非 PRD 已明确批准。
- 路由保持固定优先级和原生协议优先；只能在向客户端提交响应前 Fallback。
- Chat / Messages 只转换已覆盖的公共子集；无法无损转换时明确报错。
- Provider Key 不得明文落库或日志；Gateway Key 只存哈希并仅展示一次。
- 默认不保存 Prompt / Response。上下文预览必须显式开启、加密、有大小和保留期上限。
- Token 缺失时标记 unknown，不在网关内估算。
- isolate 缓存不是权威状态；文档和 UI 不得宣称全局强一致。

## 代码地图

- `src/gateway/`：数据面、鉴权 / 路由、配额、Fallback、协议转换和 usage finalizer。
- `src/admin/`：管理 API；`src/db/`：D1 查询；`src/shared/`：前后端共享的供应商预制等。
- `dashboard/src/`：SolidJS 控制台；`migrations/`：数据库 Schema 的唯一权威来源。
- `test/`：Vitest；`e2e/`：Playwright；`scripts/mock-provider.mjs`：无真实 Key 的本地上游。

## 修改规则

- Schema 变更只能新增下一个编号 migration；已发布 migration 不得重写。若尚未发布的 migration
  是否可改不明确，也默认新增 migration。
- Provider 预制只在 `src/shared/provider-presets.ts` 维护；不要在 Dashboard 复制一份。
- 新增用户可见行为时同步更新 PRD；实现细节同步到架构或详细设计；不要在多个文档重复整段内容。
- 保留稳定错误码、Request ID、Secret 脱敏和客户端取消传播。
- `waitUntil()` 中的统计失败不能改变已返回的 Provider 响应。
- 费用字段当前缺少聚合币种维度；在该问题修复前不要继续扩展“多币种准确统计”的承诺。

## 完成标准

至少运行：

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

涉及控制台主流程时运行 `npx playwright test e2e/journey.spec.ts`；涉及真实协议时按
`docs/TESTING.md` 运行相应集成测试。最终说明实际运行了哪些验证，以及未运行项的原因。
