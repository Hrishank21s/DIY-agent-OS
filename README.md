# AgentOS

A production-quality, self-hosted personal AI agent platform for macOS (Apple Silicon tested).
Fastify + TypeScript backend, React + Vite dashboard, SQLite storage, and the OpenCode CLI as a
replaceable AI brain.

## Features

- Multi-agent runtime: seed agents (General, Coder, Analyst, Scheduler) plus custom agents with
  per-agent system prompts, models, fine-grained permissions, timeouts, and approval policies
  (`safe`, `low`, `medium`, `high`, `always_approve`).
- Task queue: priority-aware (high/normal/low), single-process concurrency (default 2), with
  progress logs, live status events, cancellation, and retry.
- Approval engine: at-risk commands are gated before execution. `rm -rf`, `sudo`, `rm -rf`,
  `kill`, `diskutil`, `git reset/clean`, `git push` are blocked or require approval regardless of
  policy; other commands are classified by risk and the agent's policy. Owners approve/reject and
  every decision is audited.
- Memory: documented facts, user preferences, project facts, technical decisions, and memory
  classification on new inputs; similarity search with SQLite FTS5; automatic extraction from
  completed tasks.
- Projects and notes: per-project agent work directories and contextual notes injected into prompts.
- Automations: interval or cron-triggered tasks via the built-in scheduler (cron, 5-min granularity).
- Chat: per-conversation memory-first classification (respond vs. store).
- Auth: Node `crypto.scryptSync` password hashing (format `scrypt$N$r$p$salt$hash`) with a forced
  password change on first login, rate-limited login, and session cookies.
- Recovery: tasks interrupted by a restart are marked `failed` (running) or `paused`
  (waiting for approval); approved approximations are resumed safely with a double-execution guard.
- Dashboard: real-time updates over WebSocket for task status, output, approvals, and system status.

## Quickstart

Requirements: Node >= 22 (tested on 26), the OpenCode CLI, and the default model provider.

```bash
npm install
npm run build
npm run start
```

Open http://localhost:3000 and sign in with `admin` / `admin123`. You will be forced to set a
new password.

To run across your LAN, start with `AGENTOS_HOST=0.0.0.0` (already the default) and use
http://<your-mac-ip>:3000.

## Layout

- `server/` — Fastify API, services, worker, CLI, tests
- `client/` — React + Vite dashboard
- `scripts/` — launchd helpers for auto-start
- `docs/` — ARCHITECTURE, SECURITY, DEPLOYMENT, DEVELOPMENT

Configuration lives in the database (`settings` table) and via environment variables
(`AGENTOS_HOST`, `AGENTOS_PORT`, `AGENTOS_DATA_DIR`). The data directory defaults to
`~/.agentos`, and the database file is `~/.agentos/agentos.db`.

## Status

All 61 unit/integration tests pass across 7 files. The end-to-end acceptance script exercises the
full server surface (auth, CRUD, chat, tasks, approvals, cancellation, restart recovery) and is
green. See `docs/` for details and limitations.