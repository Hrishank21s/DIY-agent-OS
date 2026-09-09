# Development

## Setup

```bash
npm install
npm run build
npm run dev
```

## Tests

```bash
npm test              # runs: vitest run (server)
npx vitest run -w server
```

Current: **61 tests across 7 files pass** (`api.test.ts`, `auth.test.ts`, `command.test.ts`,
`db.test.ts`, `opencode-executor.test.ts`, `risk.test.ts`, `services.test.ts`).

### Test isolation

Each test file gets its own data directory under `<os.tmpdir()>/agentos-test/<pid>-<uuid>`.
`server/tests/setup.ts` sets `AGENTOS_DATA_DIR` at module load (config reads it at import time);
helpers are imported lazily via dynamic `await import('../tests/helpers.js')` inside hooks because
ES imports hoist above top-level statements.

Vitest config (`server/vitest.config.ts`): `root: '.'`, `server.deps.external: [/^node:/]` so
`node:sqlite` resolves under Vitest 5 / Vite 6.

### Determinism notes

- `auth.test.ts`: "rejects short new passwords" runs before "changes password" because the DB
  persists for the whole file.
- `command.test.ts` captures approval ids through the provided `onApprovalRequested` callback.
- Tests that create queued rows accumulate state; when a claim test needs a specific task, pass the
  pre-existing queued ids into the exclusion set too.

## End-to-end acceptance

```bash
bash /tmp/agentos-e2e.sh
```

A self-contained HTTP-level script (boots the built server on :3101 with its own data dir). It
covers: health + client SPA serving, bootstrap login + forced password change + old-password
rejection, CRUD (projects, notes, memory, agents, automations), chat memory classification, a full
task completion with logs, the approval API surface (list, pending count, approve with reviewer,
reject with note, audit trail), running-task cancellation, restart recovery (stale `running` →
`failed`, stale `waiting_for_approval` → `paused`), and launchd state. On success it prints
`E2E: ALL PASS`.

A few commands in it write to the DB directly via `node:sqlite` where there is no HTTP endpoint by
design (approval creation is owned by the command executor).

## Rebuilding

```bash
npm run build         # server tsc + client vite build
npm run typecheck     # tsc --noEmit on both workspaces
npm run lint          # eslint on both workspaces
```

## Key behaviors to preserve

- **Never introduce a shell into command execution.** `CommandExecutor` spawns argv arrays with
  `shell: false`. Add new flags/commands to `risk.ts` classification, not to a shell string.
- **Do not break the double-execution guard.** The queue claims with
  `claimAvailable([...this.running])`. If you add more ways to requeue in-flight tasks, extend the
  exclusion set rather than removing it.
- **Approval enum values are strict**: `safe | low | medium | high | always_approve`. The old
  `approve` value is invalid; seeds and defaults use `always_approve`.
- **Node 26 native modules do not compile** on this machine. Use `node:sqlite` and `crypto`
  primitives only; every SQLite row must be cast (`as unknown as T`) because `DatabaseSync`
  returns plain objects.
- **OpenCode streaming**: `opencode run --format json` emits `step_start`/`text`/`step_finish`
  lines plus framed `tool` / `tool_use` events. It must be spawned with `stdio: ['ignore','pipe',
  'pipe']` or it blocks waiting on stdin; an `exit`-based fallback finalizes the result so a
  grandchild holding the pipe can't hang the worker.

## Realtime events

`server/src/services/realtime.ts` is the hub. UI subscribes on `/realtime`. New server-side
occurrences (task status, output, approvals, system status) should be emitted through it and remain
best-effort (never crash the request path if a socket is missing).