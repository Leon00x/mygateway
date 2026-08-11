---
name: mygateway-admin
description: Manage and diagnose a MyGateway deployment through its hosted Management API. Use when an agent has a MyGateway URL and mgmt_ Management Key and needs to inspect onboarding state, manage LLM provider channels and unified models, issue Gateway Keys, check balances or usage, or investigate request metadata.
---

# MyGateway Admin

Operate a deployed MyGateway instance through its HTTP Management API. Call the API directly with `curl` or
an equivalent HTTP tool; this Skill is self-contained and does not depend on a repository checkout or helper
script.

## Connect and keep access

The owner provides:

```bash
MYGATEWAY_URL="https://your-gateway.example"
MYGATEWAY_MANAGEMENT_KEY="mgmt_..."
```

Persist both values on first use so the Skill still works in a new session. Prefer the agent platform's
encrypted credential store, exposing the saved values as the two environment variables above. Do not rely on
chat history or temporary agent memory.

If the platform has no credential store but has a persistent local filesystem, save the values outside every
repository in an owner-only file. For Bash, first set the two environment variables without printing them:

```bash
MYGATEWAY_CREDENTIAL_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/mygateway/credentials.env"
install -d -m 700 "$(dirname "$MYGATEWAY_CREDENTIAL_FILE")"
(umask 077; printf 'MYGATEWAY_URL=%q\nMYGATEWAY_MANAGEMENT_KEY=%q\n' \
  "$MYGATEWAY_URL" "$MYGATEWAY_MANAGEMENT_KEY" > "$MYGATEWAY_CREDENTIAL_FILE")
chmod 600 "$MYGATEWAY_CREDENTIAL_FILE"
```

Load this file at the beginning of later sessions:

```bash
MYGATEWAY_CREDENTIAL_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/mygateway/credentials.env"
set -a
. "$MYGATEWAY_CREDENTIAL_FILE"
set +a
```

Never print, commit, upload, or quote the credential file. If durable storage is unavailable, explain that the
owner must provide a Management Key again in a later session.

## Start every session

1. Load the saved connection.
2. Fetch `$MYGATEWAY_URL/skill.json`. If its version is newer than the installed manifest, update from
   `$MYGATEWAY_URL/skill.md` before continuing. If versions cannot be compared, re-read the hosted Skill.
3. Read public capabilities. Stop writes if `api_version` is not `v1`; do not guess paths from another release.
4. Perform only the operation the owner requested. Read current state before writes.

```bash
curl "$MYGATEWAY_URL/skill.json"
curl "$MYGATEWAY_URL/management/v1/capabilities"
```

Send the Management Key only to the exact host in `MYGATEWAY_URL` and only under `/management/v1/*`:

```bash
curl "$MYGATEWAY_URL/management/v1/system/status" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY"
```

`read` keys can inspect resources. `write` keys can also create, update, test, import, regenerate, and delete.
Interactive documentation is public at `$MYGATEWAY_URL/management/v1/api-docs`.

## First connection check

After installation, or whenever the saved URL or Management Key changes, inspect the deployment before asking
the owner what to do. Make one authenticated request:

```bash
curl "$MYGATEWAY_URL/management/v1/overview" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY"
```

Use this Overview response alone for the initial report. Do not follow it with separate status, channel, model,
Gateway Key, balance, usage, or log requests unless the owner asks for more detail. Report only fields actually
present in the response: do not describe usage or logs as empty merely because the deployment is new. The current
Key permission is `authorization.permission`; `capabilities.permissions` lists permission classes supported by
the API and is not the current Key's permission. Do not mention local Skill cache paths or version bookkeeping
unless an update failed and the owner must act.

Summarize, without changing anything:

- gateway version and health;
- channel count, active/disabled state, provider names, and enabled protocols;
- unified-model count, ready/unbound state, and channel instances;
- active Gateway Key count;
- current Management Key permission;
- balance support or cached status when present;
- `setup_state` and the recommended next action.

Keep the summary short and explain what the owner can do next. Follow this state guide:

- `needs_channel`: explain that no LLM API provider is connected and offer to add one.
- `needs_model`: channels exist but no active unified model is routable; offer to discover/import or bind models.
- `needs_gateway_key`: models are routable but clients have no active key; offer to create a Gateway Key.
- `ready`: report that inference is ready, list the available unified model IDs, and ask what the owner wants to
  inspect or change.

For `needs_channel`, ask only for information needed for the next safe step:

1. Provider name or a supported preset.
2. Provider API Key. Treat it as a one-time write-only value.
3. For a preset, show its default protocols and endpoints for confirmation. For a custom provider, ask which of
   `openai_chat`, `openai_responses`, and `anthropic_messages` it supports, plus each Base URL and auth scheme.
4. Run channel preflight before saving. Show detected models, then ask which should become unified models.
5. Discuss pricing only after model discovery. Use returned baseline prices when available; otherwise leave
   prices unset unless the owner supplies them. Never guess prices.

Do not ask for later-stage model pricing or Gateway Key limits in the first reply. Explain that those steps are
available, then collect their inputs only after channel preflight succeeds.

## Resource guide

### Channels — LLM API providers

A channel is a connection to one upstream LLM API provider. It stores an encrypted Provider Key and one or more
protocol endpoints. Agents can preflight, create, test, edit, disable, inspect deletion impact, or delete a
channel; they can also discover and maintain its upstream-model inventory.

Creating a channel requires a preset or provider name, a Provider API Key, and enabled protocol endpoints.
Preset defaults should be kept unless the owner asks to change them. Call `POST /channels/preflight` first;
preflight checks connectivity and discovers models without saving. Never return or repeat the Provider Key.

Prices do not belong to a channel. They belong to each channel instance of a unified model. Preflight may return
baseline input/output/cache prices in integer micros per million tokens. Preserve known baselines during import;
leave unknown values unset. If the owner gives prices in currency units per million tokens, convert them to
micros (`1 USD = 1,000,000 micros`) and retain the stated `USD` or `CNY` currency.

Common routes:

- `POST /channels/preflight`; `GET|POST /channels`
- `GET|PATCH|DELETE /channels/{id}`; inspect `/channels/{id}/delete-impact` before delete
- `POST /channels/{id}/test`
- `GET|POST|DELETE /channels/{id}/models`
- `POST /channels/{id}/models/refresh`; `POST /channels/{id}/models/import`
- `GET /channels/{id}/balance`; `GET /balances?refresh=1`

Supported protocol names are `openai_chat`, `openai_responses`, and `anthropic_messages`. Delete one inventory
entry with `DELETE /channels/{id}/models?model_id=PROVIDER_MODEL_ID`. Import accepts at most 100 models.

### Unified models — client-facing routing

A unified model is the stable model ID used by client applications. Each channel instance connects that ID to
one provider model. Multiple instances form a fixed fallback order; a full public alias routes directly to one
instance instead. One channel can appear only once in the same unified model.

Agents can create, rename, disable, or delete unified models; attach instances; set their fallback order; and
edit input/output/cache prices, currency, and streaming-usage metadata. Before creating an ID or alias, read
existing models to avoid collisions. A model is ready only when both the model and at least one linked channel
instance are active.

Common routes:

- `GET|POST /models`; `GET|PATCH|DELETE /models/{id}`
- `POST /models/{id}/instances`
- `PATCH /models/{id}/instances/{instanceId}`
- `PUT /models/{id}/instances/reorder`

### Gateway Keys — client access

Gateway Keys authenticate applications and SDKs calling `/v1/chat/completions`, `/v1/responses`,
`/v1/messages`, and `/v1/models`. They are different from Management Keys and Provider Keys.

Agents can create, list, update, disable, or delete Gateway Keys. Ask the owner about the key name, expiry,
allowed unified models, RPM, daily request limit, and daily Token limit; unspecified limits remain unlimited.
Plaintext is returned only once by create or regenerate, so show it once and do not log it.

Common routes:

- `GET|POST /gateway-keys`
- `PATCH|DELETE /gateway-keys/{id}`
- `POST /gateway-keys/{id}/regenerate`

`expires_at` is Unix seconds and `null` means permanent. Do not set `temporary:true` unless the owner explicitly
requests a fixed one-hour Dashboard key; temporary keys cannot be renewed, edited, or regenerated.

### Usage, logs, and balances — diagnostics

Usage reports requests, Provider-reported Tokens, latency, TTFT, fallback, and estimated cost. Request logs expose
metadata for troubleshooting but never Prompt/Response context through the Management API. Token values may be
unknown; never estimate them. Balance querying is provider-specific, so report unsupported or `not_queried`
states instead of treating them as zero.

```bash
curl "$MYGATEWAY_URL/management/v1/analytics/usage?range=7d&granularity=day" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY"

curl "$MYGATEWAY_URL/management/v1/logs?limit=50" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY"
```

Custom usage ranges use Unix-second `start` and `end`; granularity is `hour` or `day`. Logs support `start`,
`end`, `model_id`, `key_id`, `channel_id`, `status`, `request_id`, and cursor pagination. Keep the
`x-gateway-request-id` header when reporting failures.

## Safety and errors

- Confirm destructive operations, credential rotation, or bulk import unless the owner explicitly requested it.
- Use internal IDs from list or overview responses in paths; do not substitute display names.
- After an ambiguous write failure, read current state before retrying. Never blindly repeat a create request.
- Provider Keys may appear only in channel preflight/create/update request bodies. They are encrypted and never
  returned by MyGateway.
- Never send the Management Key to another host, put it in a URL or MyGateway resource, or place it in Skill
  source. Persist it only as described in **Connect and keep access**.
- Do not bypass the Management API through D1, Worker Secrets, Dashboard DOM, or `/admin/api/*`.
- `401 invalid_api_key`: obtain a valid, active Management Key.
- `403 insufficient_permission`: a `write` key is required.
- `409 resource_in_use`: inspect duplicates or dependencies before retrying.
- `400 invalid_request`: correct the payload or parameter; do not retry unchanged.
