---
name: mygateway-admin
description: Manage and diagnose a MyGateway deployment through its hosted Management API, including channels, unified models, Gateway Keys, balances, usage, and request-log metadata. Use when an agent is given a MyGateway URL and mgmt_ Management Key to inspect state or perform routine gateway administration.
---

# MyGateway Admin

Manage this MyGateway deployment through its HTTP Management API. This file is self-contained: call the API
directly with `curl` or an equivalent HTTP tool. No repository checkout, local helper script, or Cloudflare
account credential is required.

## Quick start

1. Get the gateway URL and a `mgmt_` Management Key from the owner. Never ask for a Provider Key.
2. Persist both values once in the agent platform's encrypted credential store and expose them as
   `MYGATEWAY_URL` and `MYGATEWAY_MANAGEMENT_KEY` in future sessions. If the platform has no durable secret
   store, use the owner-only local file described in [Connection](#connection). Do not rely on chat history or
   temporary agent memory: the skill must remain usable in a new session.
3. Install this hosted file as the `mygateway-admin` skill using the agent platform's normal skill installation
   method. Keep the adjacent `/skill.json` manifest so the installed version can be compared later.
4. Before every use, load the persisted credentials, then fetch `$MYGATEWAY_URL/skill.json`. If its `version` is newer than the installed manifest,
   update the skill from `$MYGATEWAY_URL/skill.md` before continuing. If versions cannot be compared, re-read
   the hosted `skill.md` and use it as the current instructions.
5. Read public capabilities, verify API compatibility, then perform the user's requested operation.

For a first connection, start with read-only checks:

```bash
curl "$MYGATEWAY_URL/skill.json"
curl "$MYGATEWAY_URL/management/v1/capabilities"
curl "$MYGATEWAY_URL/management/v1/system/status" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY"
```

## Connection

The setup prompt provides:

```bash
MYGATEWAY_URL="https://your-gateway.example"
MYGATEWAY_MANAGEMENT_KEY="mgmt_..."
```

Save these values through the agent platform's persistent secret or credential mechanism whenever one is
available. Store the URL as ordinary configuration and the Management Key as a secret. The platform must make
both values available to later sessions without asking the owner to paste the key again.

If no credential store exists and the agent has a persistent local filesystem, save them outside every source
repository in an owner-only file. For Bash, first place the provided values in the two environment
variables above, then run the following without printing their contents:

```bash
MYGATEWAY_CREDENTIAL_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/mygateway/credentials.env"
install -d -m 700 "$(dirname "$MYGATEWAY_CREDENTIAL_FILE")"
(umask 077; printf 'MYGATEWAY_URL=%q\nMYGATEWAY_MANAGEMENT_KEY=%q\n' \
  "$MYGATEWAY_URL" "$MYGATEWAY_MANAGEMENT_KEY" > "$MYGATEWAY_CREDENTIAL_FILE")
chmod 600 "$MYGATEWAY_CREDENTIAL_FILE"
```

Load it at the beginning of later sessions, before the version check:

```bash
MYGATEWAY_CREDENTIAL_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/mygateway/credentials.env"
set -a
. "$MYGATEWAY_CREDENTIAL_FILE"
set +a
```

Keep the file mode at `0600`, never place it inside a repository or Skill package, and never print, commit,
upload, or quote its contents. If neither a credential store nor a persistent local filesystem is available,
tell the owner that durable reuse is unavailable and request a Management Key again only when needed.

Use the exact `MYGATEWAY_URL` that hosted this file. Send the Management Key only to
`$MYGATEWAY_URL/management/v1/*`:

```bash
curl "$MYGATEWAY_URL/management/v1/system/status" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY"
```

Read capabilities first. Stop write operations if `api_version` is not `v1`; do not guess paths from a
different release:

```bash
curl "$MYGATEWAY_URL/management/v1/capabilities"
curl "$MYGATEWAY_URL/management/v1/openapi.json"
```

`read` keys can query resources. `write` keys can also create, update, test, import, regenerate, and delete.

## Safety rules

- Read current state before changing it.
- Confirm destructive or credential-rotation operations unless the user already requested them explicitly.
- Use internal `id` values returned by list operations in path parameters; do not substitute display names.
- After an ambiguous write failure, read current state before retrying. Do not blindly repeat create requests.
- A Provider Key may appear only in a channel create/update request. Never repeat it or send it elsewhere.
- Provider Keys are encrypted by MyGateway and never returned by the API.
- Gateway Keys returned by create/regenerate are one-time secrets. Show them once and do not log them.
- Never send the Management Key to another host, include it in a URL, store it in MyGateway resources, or
  place it in the Skill source. Persist it only through the credential rules in [Connection](#connection).
- Do not bypass an API refusal by accessing D1, Worker Secrets, or `/admin/api/*`.

## Channels

List channels:

```bash
curl "$MYGATEWAY_URL/management/v1/channels" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY"
```

Create an OpenAI-compatible channel:

```bash
curl -X POST "$MYGATEWAY_URL/management/v1/channels" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Example Provider",
    "provider_type":"openai_compatible",
    "base_url":"https://api.example.com/v1",
    "api_key":"PROVIDER_KEY",
    "protocols":[
      {"protocol":"openai_chat","base_url":"https://api.example.com/v1","auth_scheme":"bearer"}
    ]
  }'
```

Supported protocols are `openai_chat`, `openai_responses`, and `anthropic_messages`. Protocol `base_url`
values are editable. Before deleting a channel, read `/channels/{id}/delete-impact`.

Common routes:

- `POST /channels/preflight`
- `GET|PATCH|DELETE /channels/{id}`
- `POST /channels/{id}/test`
- `GET /channels/{id}/balance`
- `GET|POST|DELETE /channels/{id}/models`
- `POST /channels/{id}/models/refresh`
- `POST /channels/{id}/models/import`
- `GET /balances?refresh=1`

Delete one inventory entry with `DELETE /channels/{id}/models?model_id=PROVIDER_MODEL_ID`. Import takes
`{"models":[{"provider_model_id":"...","unified_model_id":"..."}]}` and accepts at most 100 items.

## Unified models

```bash
curl -X POST "$MYGATEWAY_URL/management/v1/models" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"unified_model_id":"support","display_name":"Support"}'
```

Add a channel instance after reading the model and channel IDs:

```bash
curl -X POST "$MYGATEWAY_URL/management/v1/models/MODEL_ID/instances" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "channel_id":"CHANNEL_ID",
    "channel_model_id":"provider-model-id",
    "public_model_alias":"provider-model-direct"
  }'
```

Common routes:

- `GET|POST /models`
- `GET|PATCH|DELETE /models/{id}`
- `POST /models/{id}/instances`
- `PATCH /models/{id}/instances/{instanceId}`
- `PUT /models/{id}/instances/reorder`

One channel can appear only once in a unified model. Instance order is the fallback order.

## Gateway Keys

Create a key:

```bash
curl -X POST "$MYGATEWAY_URL/management/v1/gateway-keys" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Agent-created key","model_allowlist":["support"]}'
```

Common routes:

- `GET|POST /gateway-keys`
- `PATCH|DELETE /gateway-keys/{id}`
- `POST /gateway-keys/{id}/regenerate`

Optional limits include `rpm_limit`, `daily_request_limit`, `daily_token_limit`, `expires_at`, and
`model_allowlist`; `expires_at` is Unix seconds and `null` means permanent. Plaintext is returned only by
create/regenerate. Do not set `temporary:true` unless the user explicitly requests a fixed one-hour Dashboard
key: temporary keys cannot be renewed, have their limits changed, or be regenerated.

## Usage and diagnostics

```bash
curl "$MYGATEWAY_URL/management/v1/analytics/usage?start=UNIX_SECONDS&end=UNIX_SECONDS&granularity=hour" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY"

curl "$MYGATEWAY_URL/management/v1/logs?start=UNIX_SECONDS&end=UNIX_SECONDS&limit=50" \
  -H "Authorization: Bearer $MYGATEWAY_MANAGEMENT_KEY"
```

- Usage also accepts `range=today|7d|30d`; custom ranges use `start` and `end`, never `from` and `to`.
- Usage granularity is `hour` or `day`. Logs support `model_id`, `key_id`, `channel_id`, `status`,
  `request_id`, and the returned `cursor_ts` / `cursor_id` pair for pagination.
- `/logs/{id}` returns metadata only; stored request/response context is never exposed to Management Keys.
- Token fields can be unknown when an upstream did not report usage. Do not estimate them.
- Balance support varies by provider. Report the returned support/status value instead of assuming a balance.
- Keep the `x-gateway-request-id` response header when reporting failures.

## Errors

- `401 invalid_api_key`: key missing, invalid, expired, disabled, or revoked.
- `403 insufficient_permission`: the operation needs a `write` key.
- `409 resource_in_use`: inspect existing resources and dependencies before retrying.
- `400 invalid_request`: fix the payload or parameter; do not retry unchanged.
- Other failures use a JSON `error.code` and include a request ID.
