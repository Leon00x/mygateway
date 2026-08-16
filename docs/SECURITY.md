# Security Policy

[English](SECURITY.md) · [简体中文](SECURITY.zh-CN.md)

## Reporting a vulnerability

Please do not publish credentials, prompts, responses, database exports, exploit details, or production
URLs in a public Issue. Use GitHub's private vulnerability reporting / Security Advisory flow when it is
available. If it is unavailable, open a minimal Issue asking the maintainer for a private contact channel
without including sensitive details.

Include the affected version or commit, impact, reproduction conditions, and a proposed mitigation if known.
You should receive an acknowledgement before details are made public; coordinated disclosure is preferred.

## Supported version

MyGateway is currently a `0.1.x` public alpha. Security fixes target the latest `main`; older commits and
fork-specific modifications are not maintained by this repository.

## Deployment responsibilities

- Replace the bootstrap administrator credentials immediately after first login.
- Treat `MASTER_KEY` as an internal Worker Secret. It needs no routine viewing or backup by console users; never
  delete, replace, commit, or rotate it after encrypted data exists. If the Worker Secret is lost, existing
  encrypted Provider Keys cannot be recovered and must be entered again.
- Keep Provider Keys and Gateway Keys out of Issues, logs, screenshots, traces, and test artifacts.
- Context logging is off by default. Enable it only when needed and use the shortest practical retention.
- The management login currently has no shared, durable brute-force limiter; do not advertise the console URL
  unnecessarily, and track the hardening item in [PRD](PRD.md).

The implemented key storage, session, logging, and consistency boundaries are documented in
[ARCHITECTURE](ARCHITECTURE.md).
