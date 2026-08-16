# Contributing to MyGateway

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for your interest in MyGateway. The project is small by design: it runs
on the Cloudflare free tier, prefers D1 + isolate memory over shared state, and
prioritizes "simple to run and understand" over enterprise features.

## Project principles

- **Free tier first.** No self-hosted services, no KV/R2/Queues/Durable
  Objects unless the free allowance keeps working.
- **Simple and predictable.** Fixed-priority routing, pre-response fallback,
  and no hidden background probing.
- **Easy to use.** One key, one console; sensible defaults that work out of the
  box. Prompt/response previews are off by default and only stored as encrypted,
  short-lived 4 KiB previews when the admin explicitly opts in.
- **Honest numbers.** Tokens and spend come from provider-reported usage;
  unknown usage is flagged, never guessed.

## Setting up

```bash
npm run local            # install, initialize, build, migrate, and serve on http://localhost:8787
```

Admin login on first run uses the bootstrap credentials documented in
[README.md](../README.md) (change them after login).

For a faster manual loop after setup, run `npm run build:dashboard`, `npm run dev:setup`, and `npm run dev`
separately. The one-command entry intentionally reuses these same project scripts.

## Development loop

```bash
npm run test:fast          # docs, types, unit tests, Dashboard, Worker dry-run
npm run test:e2e:serve     # local D1 + Worker in a separate terminal
npm run test:api           # Admin and Management HTTP contracts
npm run test:ui            # browser user journeys
npm run test:system        # controlled-upstream routing and streaming
npm run test:sit           # opt-in real integrations; consumes Provider usage
```

Before opening a PR make sure:

1. `npm run test:fast` passes.
2. Run every affected layer from the testing activity matrix.
3. Release maintainers run `npm run test:release`; contributors without SIT credentials use `test:release:local`.
4. Database schema changes are a new numbered migration in `migrations/`.
5. New user-visible behavior is documented in `docs/PRD.md`; implementation
   details go in the relevant architecture or design document without copying
   the same section into every file.

## Where things live

| Path | Purpose |
|---|---|
| `src/gateway/` | `/v1/*` request path: auth, routing, fallback, quota, caching |
| `src/admin/` | `/admin/api/*` control plane |
| `src/db/` | D1 statements for the different tables |
| `migrations/` | D1 schema migrations (applied in order) |
| `dashboard/` | SolidJS admin console (static assets served by the Worker) |
| `test/` | Vitest unit tests |
| `e2e/` | Playwright UI, API, controlled-upstream, and real-provider suites |

## Commit conventions

Commits follow conventional style, e.g. `feat:`, `fix:`, `docs:`, `refactor:`.
The `docs/TESTING.md` table should stay accurate.

## Getting help

Open an issue for questions and feature requests. Discuss the trade-off before
implementing — we routinely decline features that would break the free tier
or the "simple to run" promise.
