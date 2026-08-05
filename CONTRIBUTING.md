# Contributing

Thanks for your interest in MyGateway. The project is small by design: it runs
on the Cloudflare free tier, prefers D1 + isolate memory over shared state, and
prioritizes "simple to run and understand" over enterprise features.

## Project principles

- **Free tier first.** No self-hosted services, no KV/R2/Queues/Durable
  Objects unless the free allowance keeps working.
- **Simple and predictable.** Fixed-priority routing, pre-response fallback,
  and no hidden background probing.
- **Privacy by default.** We never persist prompts or responses. Request logs
  store metadata (key, model, channel, tokens, cost) only, with bounded
  retention.
- **Honest numbers.** Tokens and spend come from provider-reported usage;
  unknown usage is flagged, never guessed.

## Setting up

```bash
npm install
npm run dev:setup        # apply D1 migrations locally
npm run dev              # wrangler dev on http://localhost:8787
```

Admin login on first run uses the bootstrap credentials documented in
[README.md](README.md) (change them after login).

## Development loop

```bash
npm run typecheck        # tsc --noEmit
npm test                 # vitest unit tests
npm run test:e2e         # Playwright (some suites need DEEPSEEK_TEST_KEY)
npm run build:dashboard  # rebuild dashboard static assets into dist/
```

Before opening a PR make sure:

1. `npm run typecheck` is clean.
2. `npm test` passes (all unit tests, including new coverage for your change).
3. The dashboard builds (`npm run build:dashboard`).
4. Database schema changes are a new numbered migration in `migrations/`.
5. New user-visible behavior is documented in `README.md` / `docs/` and the
   test count is updated in `docs/TESTING.md`.

## Where things live

| Path | Purpose |
|---|---|
| `src/gateway/` | `/v1/*` request path: auth, routing, fallback, quota, caching |
| `src/admin/` | `/admin/api/*` control plane |
| `src/db/` | D1 statements for the different tables |
| `src/db/migrations/` | schema migrations (applied in order) |
| `dashboard/` | SolidJS admin console (static assets served by the Worker) |
| `test/` | Vitest unit tests |
| `e2e/` | Playwright UI / real-provider suites |

## Commit conventions

Commits follow conventional style, e.g. `feat:`, `fix:`, `docs:`, `refactor:`.
The `docs/TESTING.md` table and `README.md` test counts should stay accurate.

## Getting help

Open an issue for questions and feature requests. Discuss the trade-off before
implementing — we routinely decline features that would break the free tier
or the "simple to run" promise.
