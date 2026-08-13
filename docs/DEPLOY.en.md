# Deploying MyGateway

[English](DEPLOY.en.md) · [简体中文](DEPLOY.md)

This guide covers deployment, upgrades, rollback, troubleshooting, and Cloudflare Free Tier planning. See the [README](../README.md) for the product overview, [architecture](ARCHITECTURE.md) for system structure, and [testing guide](TESTING.md) for verification.

## 1. Deployment options

| Method | Recommendation | Notes |
|---|---|---|
| Deploy to Cloudflare button | Recommended | Browser-based; no local setup |
| Local CLI | Optional | Requires `wrangler login` |
| Workers Builds | Recommended | Automatically deploys pushes to the production branch |

## 2. How deployment works

The Deploy button lets Cloudflare read `wrangler.jsonc`, create or update the Worker named by its `name` field and the D1 database, run the deployment command, and upload `dashboard/dist` as Static Assets. Forks may choose their own Worker name before deployment.

Important behavior:

- Production does not hard-code a D1 `database_id`; Wrangler provisions it on first deployment.
- Deployment runs in this order: Dashboard build → remote D1 migrations → Worker deployment → initial secret check.
- `secrets:init` creates `INITIAL_ADMIN_PASSWORD` and `MASTER_KEY` only when they do not exist. Existing values are never overwritten.
- The initial administrator password is `mygateway123`. `MASTER_KEY` is randomly generated and printed once in deployment logs.
- Workers Logs use 10% head sampling. Gateway timing headers do not require another service.
- Passive circuit state is held in isolate memory and needs no additional Cloudflare binding.

First-deployment output includes:

```text
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=mygateway123
MASTER_KEY=<base64 backup value>
```

Save `MASTER_KEY` securely and change the administrator credentials after signing in. Once an administrator record exists in D1, the bootstrap password no longer participates in normal login.

For production troubleshooting, inspect `X-Gateway-Timing` for cache, D1, upstream-first-byte, and gateway-first-byte timing. `Server-Timing` is also emitted but may be combined with Cloudflare platform metrics. Sampled platform logs must not be used as exact request counts.

## 3. Workers Builds

Configure the Git integration so pushes to `main` trigger:

```text
Git push → Workers Builds → npm ci → Dashboard build
  → D1 migrations → Worker and Static Assets deployment → secret check
```

Recommended settings:

| Field | Value |
|---|---|
| Repository | Your fork, or `Leon00x/mygateway` when deploying the upstream repository |
| Production branch | `main` |
| Build command | `npm ci && npm run build:dashboard` |
| Deploy command | `npm run deploy` |

Do not keep the default `npx wrangler deploy` command. It publishes the Worker but does not run this repository's D1 migrations. Set the deploy command under **Cloudflare Dashboard → Settings → Builds**; the authoritative command sequence lives in `package.json`.

## 4. Upgrades and rollback

### Routine upgrades

After a change reaches `main`, Workers Builds creates the Dashboard bundle, applies pending D1 migrations, deploys the Worker and assets, and checks bootstrap secrets.

- Migrations must remain backward-compatible and are applied only once.
- A failed migration stops deployment before the new Worker is published.
- Normal upgrades do not reset the administrator password or rotate `MASTER_KEY` and provider credentials.
- Back up the original `MASTER_KEY` before upgrading.
- Run the minimum release checks from the [testing guide](TESTING.md) after a production change.

### Rollback boundary

Cloudflare can roll back Worker code and Static Assets, but it does not undo D1 migrations. Prefer additive, compatible, phased schema changes. If a database change must be reversed, add a new repair migration instead of editing or deleting an applied migration.

## 5. Common problems

1. **Wrong repository:** the Worker name is not the Git repository name. Select the real GitHub repository or fork.
2. **Worker name mismatch:** when importing manually, keep the Cloudflare target aligned with `name` in `wrangler.jsonc`.
3. **Wrong commands:** `npm run build` includes a dry-run deployment, while the default Wrangler deploy skips migrations. Use the build and deploy commands above.
4. **Missing D1 permission:** the deployment API Token needs **D1: Edit** in addition to the Workers edit template.
5. **Hard-coded database ID:** never commit an account-specific D1 ID for other users to inherit.
6. **Replaced master key:** do not delete or overwrite the production `MASTER_KEY`; existing encrypted provider credentials depend on it.

## 6. Diagnostic commands

```bash
# Deployment history
npx wrangler deployments list

# D1 databases
npx wrangler d1 list

# Pending production migrations
npx wrangler d1 migrations list DB --remote

# Live logs
npx wrangler tail

# Manual deployment with an authenticated Wrangler environment
npm run deploy
```

After deployment, verify the Worker name, console availability, completed migrations, and `/health` or one configured model. Never paste `MASTER_KEY`, Gateway Keys, Provider Keys, prompts, or full responses into logs or support tickets.

## 7. Free Tier planning

The default deployment uses:

```text
1 Worker with Static Assets
1 D1 database
2 bootstrap Secrets
1 daily Cron Trigger
```

Cloudflare limits change over time. The deployment assumptions were last checked on 2026-08-13; verify the current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) before production use. D1 index maintenance also counts toward rows written, so request volume alone is not a reliable capacity estimate.

MyGateway stays lightweight by:

- caching bounded hot configuration in isolate memory and batching cold D1 reads;
- committing usage, key usage, and optional logs in one `waitUntil()` batch without delaying the model response;
- skipping quota reads when a key has no daily budget;
- using one daily Cron only for retention cleanup, not provider polling or health checks;
- keeping passive circuit breakers and RPM windows in isolate memory instead of KV or Durable Objects.

If D1 daily limits are exhausted, configuration-dependent routes may return 503. Failed analytics writes or dashboard queries do not invalidate an already completed provider response. If representative traffic approaches the Free Tier limits, reduce optional logging and analytics overhead or move to Workers Paid—do not bypass authentication or streaming correctness.
