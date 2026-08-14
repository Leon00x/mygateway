<div align="center">

# MyGateway

**A self-hosted AI gateway built for Cloudflare.**

Connect multiple AI providers behind one API, one key system, and one management console—without running a dedicated server.

[English](README.md) · [简体中文](README.zh-CN.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Leon00x/mygateway)

[![CI](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml/badge.svg)](https://github.com/Leon00x/mygateway/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

</div>

> MyGateway is currently a `0.1.x` public alpha. It is designed for personal projects and small teams that want a compact, transparent gateway. For a broad enterprise platform with hundreds of providers and advanced tenancy, consider a mature project such as [LiteLLM](https://github.com/BerriAI/litellm).

## Why MyGateway

- **Cloudflare-native** — Worker, Static Assets, D1, Secrets, and a single Cron; no always-on server required.
- **One gateway API** — OpenAI Chat, OpenAI Responses, and Anthropic Messages endpoints behind Gateway Keys.
- **Predictable routing** — unified models, native-protocol preference, fixed priorities, fallback, and passive circuit breaking.
- **Built-in console** — manage providers, models, keys, usage, logs, pricing, and system settings in one place.
- **Self-hosted data** — provider credentials are encrypted, Gateway Keys are hashed, and prompts are not stored by default.
- **Agent-ready operations** — issue separate Management Keys and expose a self-hosted management Skill to AI agents.

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
| **Models & routing** | Unified model IDs, direct aliases, ordered provider instances, fallback, and passive circuit breaking |
| **API keys** | Expiration, model access, RPM, and request/Token budgets by day, week, month, or year |
| **Analytics** | Request and Token trends, latency, time to first token, success rate, estimated cost, and request logs |
| **Console** | Bilingual interface, light/dark themes, channel and model management, pricing, keys, logs, and settings |
| **Agent management** | Separate read/write Management Keys and a self-hosted `/skill.md` management Skill |
| **Security** | Encrypted provider credentials, hashed client keys, protected admin sessions, and opt-in encrypted context previews |

The complete implementation status and roadmap are maintained in the [PRD](docs/PRD.md).

## Deploy

Click **Deploy to Cloudflare**, connect or fork the repository, and keep the detected build and deploy commands. The deployment creates the Worker, Static Assets, D1 database, migrations, and required secrets.

Initial administrator credentials:

```text
Username: admin
Password: mygateway123
```

You must change them after the first sign-in. Keep `MASTER_KEY` safe: replacing or losing it makes existing encrypted provider credentials unreadable.

See the [deployment guide](docs/DEPLOY.en.md) for upgrades, rollback, troubleshooting, and Free Tier planning.

## Local development

Requires Node.js 22 or later.

```bash
git clone https://github.com/Leon00x/mygateway.git
cd mygateway
npm install
cp .dev.vars.example .dev.vars
# Set MASTER_KEY, for example: openssl rand -base64 32
npm run dev:setup
npm run dev
```

Open <http://localhost:8787>. Before submitting a change, run:

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

Create a read-only or read/write Management Key under **System → Management Keys & Skill**, then give the generated setup prompt to an agent. Every deployment hosts its own auditable Skill at `/skill.md`; it can manage channels, models, and Gateway Keys, and inspect balances, usage, logs, and health.

Management Keys are separate from inference Gateway Keys. Provider credentials are never returned by the Management API.

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
