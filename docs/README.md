# MyGateway documentation

[English](README.md) · [简体中文](README.zh-CN.md)

This directory keeps product decisions, engineering constraints, operations, and project policies separate from the root README. Start with the product and architecture documents when changing behavior; use the operational guides when deploying or contributing.

## Documentation map

| Area | Document | Language | What it owns |
|---|---|---|---|
| Product | [PRD](PRD.md) | 中文 | Scope, implementation status, boundaries, and roadmap—the product source of truth |
| Architecture | [Architecture](ARCHITECTURE.md) | 中文 | System boundaries, data flow, D1, caching, security, and consistency |
| Design | [Detailed design](DESIGN.md) | 中文 | Protocol, provider, model, analytics, pricing, and management API decisions |
| Providers | [Providers and models](PROVIDERS.md) | 中文 | Provider presets, model pricing baselines, and balance support |
| Deployment | [English](DEPLOY.en.md) · [中文](DEPLOY.md) | EN / 中文 | Deployment, upgrades, rollback, troubleshooting, and Free Tier planning |
| Testing | [Testing guide](TESTING.md) | 中文 | Test layers, fixtures, integration tests, and release checks |
| Contribution | [English](CONTRIBUTING.md) · [中文](CONTRIBUTING.zh-CN.md) | EN / 中文 | Development workflow and pull request requirements |
| Security | [English](SECURITY.md) · [中文](SECURITY.zh-CN.md) | EN / 中文 | Private disclosure and deployment responsibilities |
| Releases | [Changelog](CHANGELOG.md) | 中文 | Released and unreleased changes |
| Agents | [AGENTS.md](../AGENTS.md) | 中文 | Mandatory repository rules for AI-assisted development |
| Maintainer notes | [Internal notes](internal/README.md) | 中文 | One-off deployments, experiments, and process records; removable from public distributions |

## Reading paths

- **Deploying MyGateway:** README → Deployment → Security
- **Changing product behavior:** PRD → Architecture → relevant Design section → Testing
- **Adding a provider or protocol:** Provider baselines → Detailed design → Architecture → Testing
- **Contributing code:** Contributing → AGENTS.md → Testing

## Maintenance rules

- `PRD.md` is the authority for user-visible behavior and roadmap status.
- Migrations are the authority for the database schema; `0001_initial.sql` is the public baseline and published migrations are immutable.
- Architecture documents describe implemented structure. Design documents explain detailed decisions.
- README files stay concise and link here instead of duplicating implementation details.
- Update both language versions when changing bilingual public documentation.
- Keep personal environments, one-off production checks, experiments, and temporary diagnostics under
  `docs/internal/`. Removing that directory must not affect deployment or further development.
