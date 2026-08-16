<div align="center">

# MyGateway

**A simple multi-provider AI gateway you can manage with your preferred AI agent.**

Connect multiple AI providers behind one API, one key system, and one management console—without running a dedicated server.

[English](README.md) · [简体中文](README.zh-CN.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Leon00x/mygateway)

[![CI](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml/badge.svg)](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

</div>

> MyGateway is currently a `0.1.x` public alpha. It is designed for personal projects and small teams that want a compact, transparent gateway. For a broad enterprise platform with hundreds of providers and advanced tenancy, consider a mature project such as [LiteLLM](https://github.com/BerriAI/litellm).

## Why MyGateway

1. **One-click deployment to Cloudflare** — no server to maintain. The default architecture is designed for the Cloudflare Free Tier, which can cover most everyday usage for individuals and small teams.
2. **Multiple providers behind one model** — place equivalent models from different providers behind one public model name. Order channels by price or your own preference, and automatically fail over when the preferred channel is unavailable.
3. **Manage it with your preferred AI agent** — the official Skill lets agents such as Codex, Claude Code, and Pi inspect your gateway, add providers and models, manage client keys, and check balances, usage, and logs.

MyGateway also supports OpenAI Chat, OpenAI Responses, and Anthropic Messages APIs, with usage limits, cost analytics, request logs, and a bilingual console.

```text
Apps / SDKs
    │  Chat Completions · Responses · Messages
    ▼
MyGateway Worker ── authentication & limits ── routing & fallback ── AI providers
    │
    ├── SolidJS management console
    └── D1: configuration, usage aggregates, optional request logs
```

## Features

| Module | Core capabilities |
|---|---|
| **Gateway** | OpenAI Chat, OpenAI Responses, Anthropic Messages, and model discovery endpoints |
| **Providers** | Provider presets, custom endpoints, connection checks, model discovery, and encrypted credentials |
| **Models & routing** | Multiple channels per model, price- or preference-based ordering, and automatic failover |
| **API keys** | Expiration, model access, RPM, and request/Token budgets by day, week, month, or year |
| **Analytics** | Request and Token trends, latency, time to first token, success rate, estimated cost, and request logs |
| **Console** | Bilingual interface, light/dark themes, channel and model management, pricing, keys, logs, and settings |
| **Agent management** | Use the official Skill with familiar AI agents to manage providers, models, and keys or inspect balances, usage, and logs |
| **Security** | Encrypted provider credentials, hashed client keys, protected admin sessions, and opt-in encrypted context previews |

The complete implementation status and roadmap are maintained in the [PRD](docs/PRD.md).

## Deploy

Click **Deploy to Cloudflare**. Cloudflare creates a repository in your GitHub or GitLab account, provisions the prefilled `mygateway` Worker and D1 database, applies migrations, and generates the internal encryption secret. You do not need to fork first. The only application setting shown during deployment is the initial administrator password; it defaults to `mygateway123` and can be changed before deployment.

Initial administrator credentials:

```text
Username: admin
Password: mygateway123
```

You must change them after the first sign-in. MyGateway creates `MASTER_KEY` as an internal Cloudflare Secret; it needs no routine management and must not be deleted or rotated after provider credentials are stored.

See the [deployment guide](docs/DEPLOY.en.md) for upgrades, rollback, troubleshooting, and Free Tier planning.

## Run locally

Requires Node.js 22 or later.

```bash
git clone https://github.com/Leon00x/mygateway.git
cd mygateway
npm run local
```

The command installs locked dependencies when needed, creates local-only secrets, builds the console, applies D1 migrations, and starts MyGateway at <http://localhost:8787>. Local data persists in Wrangler's local state. Sign in with `admin` / `mygateway123`, then change the credentials.

For the manual development loop and test commands, see the [contributing guide](docs/CONTRIBUTING.md). Before submitting a change, run:

```bash
npm run typecheck
npm test
npm run build
```

## API example

```bash
curl https://your-gateway.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-model","messages":[{"role":"user","content":"Hello"}]}'
```

Anthropic clients can point their base URL to the same deployment and send the Gateway Key through `x-api-key` to `/v1/messages`. Responses requests use a provider's native Responses endpoint.

## Agent management

MyGateway includes an official Skill for agents such as Codex, Claude Code, and Pi. An agent can inspect the current setup, add or remove providers and models, manage client keys, and check balances, usage, logs, and service health. It asks for confirmation before important operations.

Create an agent credential under **System → Management Keys & Skill**, then give the one-line installation prompt shown there to your agent. This credential authorizes management actions without exposing provider API keys to the agent.

## Current boundaries

- Fallback is only possible before response bytes are committed; an active stream cannot move to another provider.
- RPM limits and circuit state are best-effort per isolate. Daily request and Token budgets use D1 as their authority.
- Token and cost metrics depend on provider-reported usage. Estimated cost is not a provider invoice.
- Aggregated cost currently has no currency dimension; use one accounting currency per deployment.
- Embeddings, Images, Audio, Realtime, Batch, Files, multi-user accounts, and RBAC are not currently supported.

## Documentation

Start with the [documentation index](docs/README.md).

| Document | Purpose |
|---|---|
| [Product requirements](docs/PRD.md) | Product scope, implementation status, boundaries, and roadmap |
| [Architecture](docs/ARCHITECTURE.md) | Control plane, data plane, storage, caching, and consistency |
| [Detailed design](docs/DESIGN.md) | Protocol conversion, providers, model discovery, analytics, and pricing |
| [Deployment](docs/DEPLOY.en.md) | Deployment, upgrades, rollback, troubleshooting, and Free Tier planning |
| [Testing](docs/TESTING.md) | Unit, UI, controlled-upstream, and real-provider verification |
| [Contributing](docs/CONTRIBUTING.md) | Development workflow and contribution requirements |
| [Security](docs/SECURITY.md) | Vulnerability reporting and deployment responsibilities |
| [Agent guide](AGENTS.md) | Repository constraints for AI-assisted development |

## Contributing

Issues and pull requests are welcome. Read the [contribution guide](docs/CONTRIBUTING.md) before making changes, and report vulnerabilities privately according to the [security policy](docs/SECURITY.md).

MyGateway is released under the [MIT License](LICENSE).
