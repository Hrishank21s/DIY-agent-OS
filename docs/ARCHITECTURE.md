# Architecture

AgentOS is a single Node process: a Fastify HTTP API + WebSocket hub, a background task worker,
a scheduler, and a React dashboard served from the same server. Storage is SQLite via
`node:sqlite` (`DatabaseSync`, synchronous — suitable for a single-user personal server).

## Process overview

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

## Key modules (server/src)

| Module | Responsibility |
| --- | --- |
| `config.ts` | Env + JSON config (`AGENTOS_HOST`/`PORT`/`DATA_DIR`) |
| `db/index.ts`, `db/migrate.ts`, `db/seed.ts` | SQLite bootstrap, migrations, seed agents |
| `middleware/auth.ts` | Session (cookie) auth on API routes |
| `services/auth.ts` | scrypt password hashing, password-change enforcement, rate limiting |
| `services/tasks.ts` | Task CRUD, priority claim (`claimAvailable`), logs, crash recovery |
| `services/risk.ts` | Command risk classification + mandatory-approval set + allow-rules |
| `services/command.ts` | `CommandExecutor` — argv-spawn (no shell), approval gate, allow-rules. Reusable executor for integration-driven command runs; the default task path runs the OpenCode CLI directly (see below) |
| `services/approvals.ts` | Approval lifecycle (pending/approved/rejected) |
| `services/agents.ts` | Agent registry + permission checks |
| `services/memory.ts` | Memory storage + FTS5 retrieval + type extraction |
| `services/projects.ts` / `notes.ts` | Project + note context |
| `services/automations.ts` | Interval/cron scheduling |
| `services/audit.ts` | Append-only `audit_logs` |
| `services/realtime.ts` | WebSocket event hub |
| `executors/opencode.ts` | OpenCode CLI subprocess with request/result framing |
| `workers/task-queue.ts` | Claim/poll orchestrator (protects against double-execution) |
| `workers/agent-worker.ts` | Prompt composition (agent, project, notes, memories), run, cancel, memory extraction |

## Task lifecycle

`queued → running → completed | failed | cancelled`
and `running → waiting_for_approval → (approve) queued → …` or `(reject) failed`.

`waiting_for_approval` tasks left behind by a restart are recovered to `paused`; a later approval
requeues them. Stale `running` tasks are recovered to `failed` with a message. (In the default
architecture a task never pauses mid-run at `waiting_for_approval` on its own — see “In-task
commands (OpenCode boundary)” below.)

### Double-execution protection

Approval `respond` requeues a task (`status = queued`) while the original in-flight execution may
still be alive. The queue therefore claims tasks with an exclusion set of currently-running task
ids (`claimAvailable([...this.running])`), so a requeued task is never re-claimed while its first
execution is still in flight. When the gated executor actually resumes after approval it flips the
task back to `running`.

## Approval model

`CommandExecutor.execute(argv, { agentApprovalPolicy, allowedRules, taskId, ... })`:

1. `analyzeCommand` classifies risk (`safe`…`high`) from the command name and argv. A hard-coded
   `MUST_APPROVE_COMMANDS` set (`sudo`, `rm`, `mount`, `diskutil`, `kill`, …) forces approval
   regardless of policy and cannot be bypassed by allow-rules.
2. Requires approval → inserts an `approvals` row (with an expiry window), marks the task
   `waiting_for_approval`, and emits a realtime event.
3. The executing side waits on the realtime hub for `approval:responded` and resumes only on
   approval, or gives up when the approval window expires.
4. `POST /api/v1/approvals/:id/respond` records reviewer + note, requeues (approved) or fails
   (rejected) the task, and appends an audit entry (`approval.approved` / `approval.rejected`).
   Expired approvals are rejected lazily and by the boot-time sweep.

Commands are executed with `spawn(argv[0], argv.slice(1), { shell: false })` — no shell string
interpretation — with a hard timeout and `AGENTOS_TASK_ID` set in the environment.

This executor is the platform-controlled command boundary. The default task worker does not use it:
tasks run the OpenCode CLI directly (below). Approval-driven task UI/API flows are exercised at the
service and route level by the test suite.

## In-task commands (OpenCode boundary)

A task executes by running the OpenCode CLI on the composed prompt. Commands the model issues via
its own tools are governed by OpenCode's own permission system, which in non-interactive mode
auto-rejects tool calls that request permission (e.g. writing outside the working dir, external
directories). This is the safest default: nothing dangerous runs without explicit consent, and the
model is instructed to stop and describe any sensitive action instead. Platform-level command
execution (the approval gate above) is the AgentOS-controlled path. See SECURITY.md.

## Data flow for a chat message

`POST /api/v1/chat/conversations/:id/messages` → input is classified (memory-worthy vs. reply).
Memory-worthy inputs are stored with an extracted type; the conversation returns the classification
and lets the UI surface a follow-up. Tasks remain the channel for agentic work.

## Real-time events

`/realtime` WebSocket stream: `task:status`, `task:output`, `task:opencode`, `approval:requested`,
`approval:responded`, `system:status`. The React dashboard uses these for live updates.