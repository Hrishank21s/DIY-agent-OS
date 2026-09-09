# Security

## Authentication

- Logins are rate-limited per IP (default 500 req/min overall, stricter for auth attempts).
- Passwords are hashed with Node's `crypto.scryptSync` (params N=32768, r=8, p=1) in
  `scrypt$N$r$p$salt$hash` format. Per-user random salts.
- The bootstrap account is `admin` / `admin123` and is **forced to change its password** on first
  login; the old password is immediately invalid.
- All `/api/v1/*` routes (except login/health) require a session via `requireAuth`.
- Sessions are cookie-based (`httpOnly`); production TLS is expected at your reverse proxy.
- Helmet-based hardening headers (CSP, no-sniff, click-jacking protection, HSTS, referrer policy).

## Approval gate (command execution)

The only path to shell-side effects under AgentOS control is `CommandExecutor`. Key properties:

- No shell: `spawn(argv[0], argv.slice(1), { shell: false })` — arguments are never concatenated
  into a shell string.
- Risk classification before execution (`risk.ts`):
  - `ALWAYS_APPROVE_COMMANDS` — `sudo`, `rm`, `mount`, `diskutil`, `kill`, `pkill`, `dd`, `mkfs`,
    `fdisk`, `chmod` (broad), ownership/partial trim commands — always require approval regardless
    of the agent's policy.
  - Recursive/force flags (`-r`/`-f` combined) on removal raise risk to `high` via regex
    `/(^|\s)-[-A-Za-z]*[rf]/`.
  - `git reset`/`clean` and `git push` are treated as high risk.
  - Safe reads/cats/echos/tees are classified safe and override mid-tier rules.
- Default `safe` policy: anything that isn't clearly safe (`ls`, `pwd`, `cat`, `git status`…)
  requires approval.
- Rejection does not execute the command; it is recorded in `command_logs`.

Audit trail: approvals and their outcomes are append-only in `audit_logs`; every command run is
recorded in `command_logs` with risk level and whether approval was required.

## OpenCode (in-task) boundary

OpenCode has its own permission model. In non-interactive mode a tool call that would need
permission is **auto-rejected** (nothing executes). This is intentionally the default: even a
"high" policy agent cannot silently touch files outside its granted scope. Consequences:

- An agent can reason, read its assigned working dir, and reply; it cannot perform sensitive
  actions unless you extend OpenCode permissions (e.g. an `opencode.json` in the working dir
  granting write access within it).
- Sensitive requests are meant to be surfaced as text; the platform-level approval flow is the
  sanctioned way to approve a specific action.

If you enable broader OpenCode permissions per working directory, remember that such tool calls are
then executed by OpenCode directly and do **not** pass through `CommandExecutor`. Keep the
permission scope as narrow as possible (`bash`, `write`, `edit` within the project only).

## Data-at-rest

- SQLite at `~/.agentos/agentos.db`. Keep `~/.agentos` mode 700 for a personal device.
- `AGENTOS_DATA_DIR` lets you relocate data (e.g. to an encrypted volume).
- Never expose the API to the public internet without a reverse proxy + HTTPS (Caddy/nginx) and a
  firewall; the default bind is `0.0.0.0` for LAN convenience, which also exposes it on any network
  you are connected to — consider binding `127.0.0.1` (`AGENTOS_HOST=127.0.0.1`) when you do not
  need LAN access.

## Known limitations

- Single-user: one admin account. Rate limits and forced password change mitigate brute force but
  this is not a multi-tenant design.
- In-task approval interception (OpenCode plugin that routes tool calls through `CommandExecutor`)
  is not yet implemented; therefore a running task never pauses at `waiting_for_approval` on its
  own today. The full approval state machine is unit-tested at the service/route level and
  exercised by the E2E script.
- No CSRF token on state-changing endpoints; acceptable for a localhost/LAN personal tool where
  cookies are the session carrier, but see before exposing publicly.