<div align="center">

# AgentOS

**Self-hosted personal AI agent platform for macOS**
Built with Fastify + TypeScript, React + Vite, SQLite, and the OpenCode CLI as a replaceable AI brain.

![Platform macOS](https://img.shields.io/badge/platform-macOS-333333?style=flat&logo=apple&logoColor=white)
![Node](https://img.shields.io/badge/node-%3E%3D20-success?style=flat&logo=node.js&logoColor=white&color=339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react&logoColor=black)
![Tests](https://img.shields.io/badge/tests-100%20passing-brightgreen?style=flat)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat)

</div>

---

## What is AgentOS?

AgentOS turns your Mac into a **self-hosted AI agent team**. It runs a Fastify backend and a
React dashboard in a single Node process, with SQLite storage and the OpenCode CLI as the
execution brain. Seed a few agents — General, Coder, Analyst, Scheduler — or build your own, then
queue tasks, approve risky commands, collect long-term memory, and automate recurring work.

Everything is yours: single-user by design, no cloud dependency, data lives in `~/.agentos`.

## Key features

- **Multi-agent runtime** — seed agents plus custom agents with per-agent system prompts,
  models, permissions, timeouts, and approval policies (`safe | low | medium | high |
  always_require_approval`).
- **Priority task queue** — high/normal/low priority, configurable concurrency, progress logs,
  live status events, cancellation, and retry.
- **Approval engine** — commands are classified by risk before execution. `sudo`, `rm`, `mount`,
  `diskutil`, `kill`, `dd`, `mkfs`, and friends **always require human approval** and cannot be
  overridden by allow-rules. Approvals expire, are audited, and are actionable from the dashboard.
- **Long-term memory** — facts, preferences, project context, and decisions with similarity
  search via SQLite FTS5, auto-extracted from completed tasks.
- **Projects & notes** — per-project working directories and contextual notes injected into
  agent prompts.
- **Automations** — interval or cron-triggered tasks via a built-in scheduler.
- **Chat** — memory-first classification (reply vs. store) per conversation.
- **Hardened auth** — scrypt password hashing, forced password change on first login,
  rate-limited login, and `httpOnly` + `SameSite=Strict` session cookies.
- **Crash recovery** — interrupted tasks are recovered on restart with a double-execution guard.
- **Real-time dashboard** — WebSocket-driven live updates for task status, output, approvals,
  and system health.
- **No shell execution** — commands run via `spawn(argv, { shell: false })`, so argv is never
  string-interpreted.

## How a task runs

A task is executed by running the OpenCode CLI on a composed prompt (agent system prompt +
project context + notes + relevant memories). Commands the model issues through its own tools are
governed by OpenCode's permission system, which in non-interactive mode **auto-rejects** tool calls
that request permission. The platform-level approval gate is the AgentOS-controlled path for
integration-driven commands. See `docs/SECURITY.md` for the exact boundaries.

## Architecture

```
                    ┌──────────────────────────────────────────────┐
   Browser ───────▶ │ Fastify (port 3000, 0.0.0.0)                 │
   (React SPA)      │  /api/v1/* REST + /realtime WS hub           │
                    │  static client/dist + SPA fallback           │
                    ├──────────────────────────────────────────────┤
                    │ TaskQueue worker (poll 1s, concurrency N)    │
                    │   └ AgentWorker ──▶ OpenCodeExecutor ──▶ CLI  │
                    ├──────────────────────────────────────────────┤
                    │ Scheduler (interval / cron automations)      │
                    └──────────────────────────────────────────────┘
```

Task lifecycle: `queued → running → completed | failed | cancelled`, plus `waiting_for_approval`
gates. See [Architecture](docs/ARCHITECTURE.md) for module maps, the approval model, and realtime
events.

## Quickstart

Requirements: **Node >= 22** (tested on 26), the **OpenCode CLI**, and a model provider.

```bash
npm install
npm run build
npm run start
```

Open **http://localhost:3000**.

On first start the server prints bootstrap credentials: from `AGENTOS_BOOTSTRAP_USERNAME` /
`AGENTOS_BOOTSTRAP_PASSWORD` when set, otherwise a randomly generated username and password
(shown only once). You'll be forced to set a new password on first login.

### Access from your LAN

Start with `AGENTOS_HOST=0.0.0.0` (the default) and browse to `http://<your-mac-ip>:3000`.
Because state-changing requests are only accepted from loopback or explicitly configured origins,
set:

```bash
AGENTOS_PUBLIC_ORIGIN=http://<your-mac-ip>:3000
```

...or add the origin to `AGENTOS_TRUSTED_ORIGINS`.

## Development

```bash
npm install
npm run dev        # server + client with hot reload
npm test           # 100 tests across server + client
npm run lint       # eslint for both workspaces
npm run typecheck  # tsc for both workspaces
npm run doctor     # server health checks
```

See [Development](docs/DEVELOPMENT.md) for test isolation notes, determinism details, and key
behaviors to preserve.

## Project layout

```
├── server/    # Fastify API, services, workers, CLI, migrations, tests
├── client/    # React + Vite dashboard (13 pages, WebSocket realtime)
├── scripts/   # launchd helpers for auto-start on macOS
├── docs/      # ARCHITECTURE · SECURITY · DEPLOYMENT · DEVELOPMENT · RELEASE-AUDIT
├── LICENSE    # MIT
└── README.md
```

Configuration lives in the DB (`settings` table) and via environment variables
(`AGENTOS_HOST`, `AGENTOS_PORT`, `AGENTOS_DATA_DIR`, `AGENTOS_BOOTSTRAP_USERNAME`,
`AGENTOS_BOOTSTRAP_PASSWORD`, ...). Data defaults to `~/.agentos/agentos.db`.
[Deployment](docs/DEPLOYMENT.md) has the full reference.

## Documentation

| Doc | Contents |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Process overview, modules, task lifecycle, approval model |
| [Security](docs/SECURITY.md) | Auth, CSRF, approval gate, OpenCode boundary, data at rest |
| [Deployment](docs/DEPLOYMENT.md) | Setup, LAN, reverse proxy, launchd, env var reference |
| [Development](docs/DEVELOPMENT.md) | Setup, tests, key behaviors |
| [Release audit](docs/RELEASE-AUDIT.md) | Pre-release security audit and hardening report |

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. In short:
open an issue to discuss your change first, fork, create a feature branch, and submit a pull
request — tests must pass.

## Roadmap

- [x] Agent runtime with approval policies
- [x] Priority task queue with crash recovery
- [x] FTS5 long-term memory
- [x] Cron automations
- [x] Real-time dashboard
- [ ] Docker containerization
- [ ] Multi-user / team support
- [ ] More executors beyond OpenCode CLI

## License

[MIT](LICENSE) © 2026 Hrishank21s