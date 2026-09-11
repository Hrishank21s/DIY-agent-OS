# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MIT license
- `CONTRIBUTING.md` with contribution guidelines
- GitHub issue templates (bug report, feature request) and pull request template
- `.editorconfig` for consistent editor settings
- README badges, revamped structure, and roadmap

## [1.0.0] - 2026-09-10

### Added

- Fastify + TypeScript backend with a React + Vite dashboard served from a single Node process
- Multi-agent runtime: General, Coder, Analyst, Scheduler seed agents plus custom agents with
  per-agent system prompts, models, permissions, timeouts, and approval policies
  (`safe | low | medium | high | always_require_approval`)
- Priority-aware task queue (high/normal/low) with configurable concurrency, progress logs,
  live status events, cancellation, and retry
- Platform-level approval engine: `sudo`, `rm`, `mount`, `diskutil`, `kill`, `dd`, `mkfs`, and
  friends always require human approval; other commands are classified by risk. Approvals expire,
  are audited, and are actionable from the dashboard and API
- Long-term memory with SQLite FTS5 similarity search and automatic extraction from completed tasks
- Projects and notes with per-project working directories and contextual note injection
- Interval and cron-triggered automations via a built-in scheduler (5-minute granularity)
- Chat with per-conversation memory-first classification (respond vs. store)
- scrypt password hashing, forced password change on first login, rate-limited login, and secure
  session cookies (`httpOnly`, `SameSite=Strict`)
- Crash recovery: interrupted tasks are recovered on restart with a double-execution guard
- Real-time WebSocket dashboard updates for task status, output, approvals, and system status
- OpenCode CLI executor with `shell: false` argv spawning and an executable allowlist
- launchd helpers for auto-start on macOS
- 100 tests (89 server + 9 client) covering auth, approval gating, risk classification, command
  execution, task queueing, and the UI

### Security

- Bootstrap credentials with forced password change on first login
- Origin validation on all state-changing requests (loopback or trusted origins only)
- Command risk classification with a hard-coded mandatory-approval set that cannot be bypassed
  by allow-rules
- Non-interactive OpenCode mode auto-rejects permission-gated tool calls
- Append-only audit log
- Full pre-release audit documented in `docs/RELEASE-AUDIT.md`

[Unreleased]: https://github.com/Hrishank21s/DIY-agent-OS/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Hrishank21s/DIY-agent-OS/releases/tag/v1.0.0