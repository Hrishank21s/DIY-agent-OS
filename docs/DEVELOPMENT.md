# Development

## Setup

```bash
npm install
npm run build
npm run dev
```

## Tests

```bash
npm test              # runs vitest run in both server and client workspaces
npm run test -w server
npm run test -w client
```

Current: **89 server tests across 10 files pass** (`api.test.ts`, `auth.test.ts`, `command.test.ts`,
`db.test.ts`, `ndjson-worker.test.ts`, `opencode-executor.test.ts`, `probe-config.test.ts`,
`risk.test.ts`, `services.test.ts`, `worker-empty-result.test.ts`) and **9 client component tests
across 3 files pass**.

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
- `command.test.ts` captures approval ids through the provided `onApprovalRequested` callback; the
  executor resumes event-driven on `approval:responded` from the realtime hub.
- Tests that create queued rows accumulate state; when a claim test needs a specific task, pass the
  pre-existing queued ids into the exclusion set too.

## Acceptance testing

There is no checked-in end-to-end script. The HTTP surface (auth incl. bootstrap + forced password
change, CRUD, chat, tasks, approvals, cancellation, restart recovery) is covered by
`server/tests/api.test.ts` plus the service-level suites. To smoke-test manually: `npm run build`,
then `npm run start` with a scratch `AGENTOS_DATA_DIR` and drive the UI at http://localhost:3000.

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
- **Approval enum values are strict**: `safe | low | medium | high | always_require_approval`. The
  legacy `always_approve` spelling is accepted and normalized; the old `approve` value is invalid.
  Seeds and defaults use `always_require_approval`.
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