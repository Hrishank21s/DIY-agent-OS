# AgentOS — Project Checkpoint

- **Checkpoint time:** 2026-09-20T12:39:05Z
- **Checkpoint type:** initial
- **Git:** branch `main` @ `136c225` / `136c2256c5ac23494c5815c668eba2c1b71cb998`, working tree **clean**, pushed to `origin/main`
- **Node:** v26.6.0 (project requires >=22.5, needs node:sqlite)

---

## 1. Project identity

| Key | Value |
| --- | --- |
| Name | AgentOS (repo dir `DIY-agent-OS`) |
| Type | node (TypeScript) |
| Root | `/Users/hrishank21s/Desktop/Projects/open code agent/DIY-agent-OS` |
| Package manager | npm (workspaces monorepo) |
| Monorepo | yes — `workspaces: ["server", "client"]` |
| License | MIT |
| Git remote | `origin` → https://github.com/Hrishank21s/DIY-agent-OS.git |

Top-level structure:
```
.editorconfig  .env.example  .git/  .github/  .gitignore  CHANGELOG.md
CONTRIBUTING.md  LICENSE  README.md  client/  docs/  node_modules/
package-lock.json  package.json  scripts/  server/
```

- `server/` — Fastify API, services, workers (task-queue, agent-worker), OpenCode
  executor, scheduler, CLI (`src/cli/main.ts`), migrations, vitest suite (100 tests).
  DB is Node 22.5+ `node:sqlite` (no better-sqlite3 dep). Realtime is **SSE**
  (`/api/v1/realtime/events`), not WebSocket.
- `client/` — React 18 + Vite dashboard (`src/main.tsx`, `src/App.tsx`), 9 vitest tests.
- `docs/` — ARCHITECTURE, SECURITY, DEPLOYMENT, DEVELOPMENT, RELEASE-AUDIT.
- `scripts/` — launchd helpers for auto-start on macOS.

Key entry points:
- Server: `server/src/index.ts` (`config`, `buildServer`), compiled to `server/dist/index.js`.
- CLI: `server/src/cli/main.ts` (`npm run cli -w server`).
- Dashboard: `client/dist` served via `@fastify/static` with SPA fallback.

Commands:
- install: `npm install` (postinstall builds the client)
- build: `npm run build` (server tsc + client vite build)
- start: `npm run start` → `node server/dist/index.js`
- dev: `npm run dev` (concurrently: server `tsx watch` + client `vite`)
- test: `npm test` (server vitest + client vitest)
- typecheck: `npm run typecheck` (both workspaces)
- lint: `npm run lint` (both workspaces)
- migrate: `npm run migrate -w server`
- doctor: `npm run doctor -w server`
- cli: `npm run cli -w server`

---

## 2. Where we started

**Original objective:** execute the AgentOS security audit and apply all its
findings (labelled #1–#34 across server + client + docs + CI), then review,
verify, commit and ship the hardened state.

**Original constraints:**
- Single-user, self-hosted; no cloud dependency; data under `~/.agentos` (default, `~` expanded).
- macOS-first; Node >= 22.5 (node:sqlite); OpenCode CLI as the replaceable exec "brain".
- No shell execution — commands run via `spawn(argv, { shell: false })`.
- Do not push until asked (user later asked to push).
- Do not introduce unrelated changes.

**Early architecture decisions (pre-audit, preserved):**
- npm workspaces monorepo (`server`, `client`); Fastify + TypeScript backend serving the React SPA from one process.
- SQLite via `node:sqlite` + FTS5 virtual table for memory search (`memories_fts_index`).
- SSE hub for realtime updates; `@fastify/websocket` removed as dead code (audit LOW #27).
- OpenCode CLI executor with strict allowlist (basename `opencode` only).
- Append-only `audit_logs`; per-command `command_logs`.

---

## 3. Current state

**Milestone: security audit COMPLETE.** All audit findings applied, tested,
reviewed, committed (`136c225`) and pushed to `origin/main`.

- Working tree clean; `origin/main` == local `main`.
- Server running locally on `127.0.0.1:3000` for interactive testing. A fresh
  bootstrap admin account was created on first boot; the one-time password is in
  the server boot log (see secrets note — NOT stored here).
- All verification green at checkpoint time (see section 10).

Audit coverage by area:
- **Auth (#12, #16, #17, #26, #32):** scrypt N=65536 for new hashes (legacy 32768
  still computes), timing-equalized login via precomputed dummy hash, per-username
  lockout via `login_attempts` (5 fails / 15 min window / 15 min lockout,
  settings-driven), session pruning to 50/user, settings-driven `login_rate_limit`
  + global `session_rate_limit`, client requires current password on forced change.
- **Approvals / risk (#1, #3, #13, #18, #20, #21):** basename command classification
  closes the `/bin/rm`, `/usr/bin/sudo` bypass of the mandatory-approval gate;
  word-boundary git subcommand matching; output caps (command 200k, opencode text
  200k / events 10k); approval `get()` read-only (expiry via explicit
  `expireStale()`); settings-driven `approval_rules`; agent delete nullifies FKs.
- **Automations / lifecycle (#4, #7):** `one_time` automations never re-armed
  (past target never armed; fired → next_run_at NULL); children spawn `detached`
  (own process group) and cancel kills the group; `worker.killAll()` on queue stop.
- **Server config / hardening (#6, #8, #9, #10, #11, #12, #14, #15, #23, #24, #25,
  #34):** loopback bind default; `AGENTOS_TRUST_PROXY` = hop count (disabled
  default); static traversal guard (reject `..` / `%2e%2e` outside `/api/`); minimal
  `/api/health`; error handler no longer passes arbitrary 4xx messages; zod
  validation + limit clamps (tasks PATCH incl. pause/resume, chat conversations,
  logs, memory); FK nullify on agent/project delete; GET endpoints no longer
  `touch()` memory; `/api/v1/system/status` shape matches client `SystemStatusInfo`;
  CLI verifies PID before SIGTERM; doctor enforces Node >= 22.5; `execSync`→`spawnSync`.
- **Cleanup / deps (#22, #27, #29):** removed `@fastify/websocket`,
  `@fastify/csrf-protection`, `fastify-plugin`, `@types/better-sqlite3`; removed dead
  `memories_fts` table (migrations 001 + 003); FTS failures logged; GitHub Actions
  CI (Node 22 + 24, typecheck + tests on both workspaces).
- **Docs (#28 + HIGH #3):** README, SECURITY.md, CHANGELOG.md, DEPLOYMENT.md updated
  (loopback default, trust-proxy hops, lockout, env-inheritance warning, tests badge 109).

**Architecture (current):**
`Browser → Fastify (3000, 127.0.0.1) → /api/v1/* REST + /realtime SSE hub → static client/dist + SPA fallback`
`TaskQueue (poll 1s, concurrency 2 default) → AgentWorker → OpenCodeExecutor → opencode CLI`
`Scheduler (interval/cron automations, 5-min granularity)`.

---

## 4. Work completed

1. Risk classification (`server/src/services/risk.ts`): `commandName()` basename
   matcher; cleaned HIGH/MEDIUM sets (dead multi-word git entries, duplicate
   rm/rmdir removed); word-boundary git rules. Regression tests in
   `server/tests/risk.test.ts` (absolute paths, subcommand classification,
   whitelist-rename bypass).
2. Auth hardening (`server/src/services/auth.ts`, `routes/auth.ts`): dummy-hash
   timing equalization, lockout in new `login_attempts` table
   (`server/migrations/003_login_lockout_and_cleanup.sql`), pruneSessions,
   settings-driven limits.
3. Automation loop fix (`server/src/services/automations.ts`): `serializeNext()`
   + next_run_at NULL on one_time fire. Tests in `server/tests/services.test.ts`.
4. Approvals read-only (`server/src/services/approvals.ts`): removed isExpired /
   write-on-read; explicit `expireStale()`.
5. Executor/worker hardening (`server/src/executors/opencode.ts`,
   `workers/agent-worker.ts`, `workers/task-queue.ts`): output caps, synchronous
   `onController`, `detached: true` group kill, `killAll()` on stop, settings-driven
   task timeout + memory-importance threshold.
6. Command executor (`server/src/services/command.ts`): `MAX_COMMAND_OUTPUT`,
   `parseApprovalRules()` from settings.
7. Server bootstrap (`server/src/index.ts`): trustProxy cast (root cause of the
   typecheck failure — fastify option type accepts no `number`), helmet CSP
   replaced on plain HTTP (drop `upgrade-insecure-requests`), settings-driven global
   rate limit, traversal guard, minimal health, tightened error handler.
8. Config/CLI/password (`server/src/config.ts`, `src/cli/index.ts`,
   `src/lib/password.ts`): `intEnv` clamps, `expandHome`, `fileURLToPath` rootDir,
   hop-count trust proxy; CLI safe-stop + doctor Node check + spawnSync; scrypt N=65536.
9. Client (`client/src/pages/ForcePasswordChange.tsx`): current password required.
10. Docs & meta: README/SECURITY/CHANGELOG/DEPLOYMENT; `.env.example` (loopback,
    hop-count trust proxy, data dir); `.github/workflows/ci.yml`; lockfile
    regenerated to match removed deps.

**Commit:** `136c225` `fix(security): harden authentication, approvals, and server configuration`
(37 files, +688/−375). Earlier commits this repo: `c48ad33` initial, `6a8feb5`
22-phase hardening, `5b3b118` repo decoration, `5495e88` contributing docs.

---

## 5. Work remaining

- Runtime smoke-testing by the user on the live server at `http://127.0.0.1:3000`
  (login → forced password change → run a real task against a model provider).
  Nothing code-side pending.
- Non-blocking CI/runbook niceties:
  - Confirm `npm ci` in CI works end-to-end given `postinstall` builds the client
    (vite/esbuild) — not exercised in CI yet.
  - npm `allow-scripts` blocks esbuild/fsevents postinstall scripts (works in
    practice via platform-binary optional deps; npx warnings pending).
- Project roadmap (outside this audit): Docker containerization, multi-user/team,
  additional executors.

---

## 6. Problems / issues

- No open bugs, failing tests, type errors, or known regressions at checkpoint time.
- Non-blocking observations (see `issues.md`):
  - npm allow-scripts warnings for esbuild/fsevents (no-op today).
  - Lockout failure count is per-username, not per-IP (decisions D02 / issue I-02).
  - `@fastify/static` 8.x advisory documented as unreachable in SECURITY.md (upgrade
    needs Fastify 6 — planned future).
  - Bootstrap admin password prints once to standard output on first boot by design;
    treat the boot log as sensitive until the password is rotated at first login.

---

## 7. Decisions

Full append-only log in `decisions.md`. Highlights (do not casually revert):

- **D01** Loopback bind default (`127.0.0.1`), opt-in `0.0.0.0` for LAN — prevents
  accidental network exposure; updated config, seed, CLI, docs.
- **D02** `AGENTOS_TRUST_PROXY` = hop count (`true`→1), disabled by default — never
  an unbounded proxy chain, so spoofed `X-Forwarded-For` can't rotate past rate limits.
- **D03** Risk classification on basename — closes the absolute-path bypass of the
  mandatory-approval gate.
- **D04** `one_time` automations never re-armed — past targets NULL on create; fired
  ones NULL after trigger (the 10s poll would otherwise re-fire forever).
- **D05** Approval `get()` is strictly read-only; expiry only via explicit
  `expireStale()` (removed write-on-read side effect).
- **D06** Settings are enforced at run time (approval_rules, login_rate_limit,
  session_rate_limit, login_failed_attempts, login_lockout_minutes,
  memory_importance_threshold, task_timeout_ms), not advisory.
- **D07** scrypt N=65536 for new hashes; `verifyPassword` derives maxmem from stored
  N so legacy hashes keep working.
- **D08** Login timing-equalized with a precomputed dummy hash; lockout checked
  before verification work.
- **D09** Removed @fastify/websocket + @fastify/csrf-protection (dead code; SSE +
  Origin/SameSite defense-in-depth is the model).
- **D10** Helmet CSP disabled on plain-HTTP serving, replaced with an equivalent
  header that omits `upgrade-insecure-requests` (that directive blanks an
  HTTP-served dashboard).
- **D11** `.agent/` checkpoint is committed to the repo (no secrets stored;
  cross-machine durability).

---

## 8. Current working context

- **Last successful actions (immediately before this checkpoint):**
  1. Pushed `main` to `origin` (`5b3b118..136c225`).
  2. Started the local server (`npm run start -w server`) and smoke-tested:
     `/api/health` → `{"status":"ok"}`; GET `/` serves the dashboard;
     `POST /api/v1/auth/login` sets a session cookie and returns
     `requiresPasswordChange: true`; authed `/api/v1/system/status` is correctly
     blocked by the forced-password-change gate.
  3. User asked to "make all latest to github" — done (`git push origin main`).
- **Next recommended action:** hand the user the running server at
  `http://127.0.0.1:3000`; they log in with the bootstrap admin account
  (credentials in the server boot log, one-time), complete the forced password
  change, and exercise a real task end-to-end against a model provider.
- **Next commands/files to inspect:**
  - Server boot log: `/var/folders/86/1dtng16s46qg1_nx8p5jq0240000gn/T/opencode/agentos-server.log`
    (bootstrap credentials + startup diagnostics).
  - `npm run doctor -w server` for a health report.
  - `server/src/index.ts` for current bootstrap wiring (rate limits, static guard,
    CSP/helmet branch).
- **Assumptions:**
  - The user supplies a model provider key to the environment (OpenCode CLI) for
    real task execution.
  - A fresh `~/.agentos/agentos.db` was created by the running server
    (bootstrap admin exists).
  - `opencode` CLI is on PATH and is the intended executor.
- **Open investigations:** none. (Earlier concern re `approval_rules` settings
  schema rejecting `string[]` values was fixed — settings.ts uses
  `z.record(z.union([z.string(), z.array(z.string())]))`.)

---

## 9. Since last checkpoint

Initial checkpoint — no prior `.agent/` existed. Entire pre-checkpoint history is
captured in git history (`c48ad33` initial → `6a8feb5` 22-phase hardening → `5b3b118`
repo decoration → `136c225` security-audit commit). No project drift to compute.

---

## 10. Verification status

At checkpoint time (all CONFIRMED this session):

- Server: typecheck ✓, lint ✓ (0 warnings), tests 100/100 ✓.
- Client: typecheck ✓, lint ✓, tests 9/9 ✓.
- Build: `npm run build` ✓ (server tsc + client vite).
- Live smoke test: `/api/health` ✓, static dashboard ✓, login + session cookie ✓,
  auth gate ✓.
- `UNVERIFIED`: end-to-end task execution against a model provider (requires a user
  API key in the environment); CI run on GitHub (workflow added, not yet executed).

---

## 11. Secrets note

This checkpoint was scanned for secret material (API keys, tokens, passwords,
private keys, .env values) and **no secrets are stored**. Presence only is recorded:

Required environment variables exist (names only, values NOT stored):
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (used by the OpenCode CLI task executor).

The runtime server created a bootstrap admin account and printed a one-time
password to the server boot log; that value is intentionally NOT written here —
see the boot log at the path in section 8 and rotate it at first login.
