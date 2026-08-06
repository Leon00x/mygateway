# Security Policy

## Supported versions

MyGateway is a small personal-gateway project. Only the latest commit on
`main` is supported; releases are cut from `main` when meaningful.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them
privately instead:

- GitHub: use the "Report a vulnerability" flow on the repository
  (Security → Advisories), or
- Email the maintainer via the address listed on the GitHub profile.

We aim to acknowledge reports within 72 hours and to ship a fix in a timely
manner depending on severity.

## What is in scope

- Gateway authentication bypass (using another gateway key, or provider keys)
- Injection into D1 queries via admin or gateway inputs
- Exposure of `MASTER_KEY`, provider keys, gateway key material, or admin
  session cookies
- Misconfiguration that breaks the "provider key stays encrypted" guarantee

## Security notes for operators

- `MASTER_KEY` is shown **once** at deploy time. Keep it in Cloudflare Secrets,
  never in the repository or client code.
- Provider API keys are encrypted at rest (AES-GCM with `MASTER_KEY`) and only
  decrypted in-process when a request is routed to that provider.
- Gateway keys are stored as SHA-256 hashes; the raw key is shown once at
  creation and cannot be recovered later.
- Admin API requires a session cookie; mutation requests are protected against
  cross-origin CSRF. Keep the dashboard behind an allowlist or same-origin
  network controls if your workload needs them.
- Request logs record metadata (key, model, channel, tokens, cost, timing) by
  default. Prompt/response previews are only stored when the admin explicitly
  enables the encrypted “record context” option (4 KiB per direction, short
  retention); keys, Authorization and provider credentials are never logged.
