---
name: mygateway-admin
description: Manage and diagnose a MyGateway deployment through its hosted Management API, including channels, unified models, Gateway Keys, balances, usage, and request-log metadata. Use when an agent is given a MyGateway URL and mgmt_ Management Key to inspect state or perform routine gateway administration.
---

# MyGateway Admin

Manage this MyGateway deployment through its HTTP Management API. This file is self-contained: call the API
directly with `curl` or an equivalent HTTP tool. No repository checkout, local helper script, or Cloudflare
account credential is required.

## Connection

The setup prompt provides:

```bash
MYGATEWAY_URL="https://your-gateway.example"
MYGATEWAY_MANAGEMENT_KEY="mgmt_..."
```

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
- Never send the Management Key to another host, include it in a URL, or store it in MyGateway resources.
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
