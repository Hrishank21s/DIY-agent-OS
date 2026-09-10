# AgentOS

A self-hosted, single-user AI agent platform for macOS (Apple Silicon tested).
Fastify + TypeScript backend, React + Vite dashboard, SQLite storage, and the OpenCode CLI as a
replaceable AI brain.

## Features

- **Multi-agent runtime**: seed agents (General, Coder, Analyst, Scheduler) plus custom agents with
  per-agent system prompts, models, permissions, timeouts, and approval policies
  (`safe | low | medium | high | always_require_approval`).
- **Task queue**: priority-aware (high/normal/low), single-process concurrency (default 2), with
  progress logs, live status events, cancellation, and retry.
- **Approval engine**: the platform-level approval gate classifies commands before execution.
  `sudo`, `rm`, `mount`, `diskutil`, `kill`, `dd`, `mkfs`, and friends always require human
  approval regardless of the agent's policy and cannot be overridden by allow-rules; other
  commands are classified by risk against the agent's policy. Approvals carry an expiry window,
  are audited, and are actionable from the dashboard and API.
- **Memory**: documented facts, user preferences, project facts, and technical decisions with
  similarity search via SQLite FTS5 and automatic extraction from completed tasks.
- **Projects and notes**: per-project working directories and contextual notes injected into prompts.
- **Automations**: interval or cron-triggered tasks via the built-in scheduler (cron, 5-min granularity).
- **Chat**: per-conversation memory-first classification (respond vs. store).
- **Auth**: Node `crypto.scryptSync` password hashing (format `scrypt$N$r$p$salt$hash`), a forced
  password change on first login, rate-limited login, and secure session cookies
  (`httpOnly`, `SameSite=Strict`).
- **Recovery**: tasks interrupted by a restart are marked `failed` (running) or `paused`
  (waiting for approval); approved approvals are requeued with a double-execution guard.
- **Dashboard**: real-time updates over WebSocket for task status, output, approvals, and system status.

## How a task runs

A task is executed by running the OpenCode CLI on the composed prompt. Commands the model issues
through its own tools are governed by OpenCode's permission system, which in non-interactive mode
auto-rejects tool calls that request permission. Platform-level command approval (the gate above)
is the AgentOS-controlled path and is exercised through the approvals API/UI for tasks and commands
created by integrations. See `docs/SECURITY.md` for the exact boundaries.

## Quickstart

Requirements: Node >= 22 (tested on 26), the OpenCode CLI, and a model provider for OpenCode.

```bash
npm install
npm run build
npm run start
```

Open http://localhost:3000. On first start the server prints the bootstrap credentials to the
console: either from `AGENTOS_BOOTSTRAP_USERNAME` / `AGENTOS_BOOTSTRAP_PASSWORD` when set, or a
random username and password generated automatically (shown only once). You will be forced to set
a new password on first login.

To run across your LAN, start with `AGENTOS_HOST=0.0.0.0` (the default) and use
http://<your-mac-ip>:3000. Because state-changing requests are only accepted from loopback or
explicitly configured origins, access from a non-loopback address needs
`AGENTOS_PUBLIC_ORIGIN=http://<your-mac-ip>:3000` (or add that origin to `AGENTOS_TRUSTED_ORIGINS`).

## Layout

- `server/` — Fastify API, services, worker, CLI, tests
- `client/` — React + Vite dashboard
- `scripts/` — launchd helpers for auto-start
- `docs/` — ARCHITECTURE, SECURITY, DEPLOYMENT, DEVELOPMENT

Configuration lives in the database (`settings` table) and via environment variables
(`AGENTOS_HOST`, `AGENTOS_PORT`, `AGENTOS_DATA_DIR`, `AGENTOS_BOOTSTRAP_USERNAME`,
`AGENTOS_BOOTSTRAP_PASSWORD`). The data directory defaults to `~/.agentos`, and the database file
is `~/.agentos/agentos.db`.

## Status

Server unit/integration tests and client component tests pass (see `docs/DEVELOPMENT.md` for
exact counts and how to run them). See `docs/` for architecture, deployment, and security details
and limitations.