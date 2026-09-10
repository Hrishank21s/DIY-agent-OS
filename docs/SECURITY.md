# Security

## Authentication

- Logins are rate-limited per IP, and all routes run behind a global rate limit (default
  `max: 500`, `timeWindow: '1 minute'`; auth paths have a stricter limit).
- Passwords are hashed with Node's `crypto.scryptSync` (params N=32768, r=8, p=1) in
  `scrypt$N$r$p$salt$hash` format. Per-user random salts.
- Bootstrap credentials come from `AGENTOS_BOOTSTRAP_USERNAME` (default `admin`) and
  `AGENTOS_BOOTSTRAP_PASSWORD`. In production the bootstrap password must be at least 8 characters
  and not one of the built-in weak passwords; otherwise a strong random password is generated and
  printed once to the server console. The bootstrap account has `must_change_password = 1` and is
  **forced to change its password on first login**; the old password is immediately invalidated.
- All `/api/v1/*` routes (except login/health) require a session via `requireAuth`.
- The browser UI authenticates with a session cookie (`httpOnly`, `SameSite=Strict`, `secure` in
  production mode, 480 minutes default). API clients may also authenticate with an
  `Authorization: Bearer <token>` header; `extractToken` accepts both. Production TLS is expected
  at your reverse proxy.
- Helmet-based hardening headers: Content-Security-Policy (always on), no-sniff, click-jacking
  protection, referrer policy, and HSTS when served over HTTPS.

## Cross-origin protection

- The session cookie is `SameSite=Strict`, which prevents the browser from sending it on
  cross-site requests — the primary CSRF defense.
- Defense-in-depth: state-changing requests (POST/PUT/PATCH/DELETE) that carry an `Origin` header
  are rejected with 403 unless the origin is loopback (`localhost`, `127.0.0.1`, `::1`) or one of
  the configured trusted origins (`AGENTOS_PUBLIC_ORIGIN`, `AGENTOS_TRUSTED_ORIGINS`). The check
  compares only against those configured values, never against the request `Host` header.
  Access from a non-loopback address (e.g. LAN) therefore requires the origin to be configured.
- Requests without an `Origin` header (typical for non-browser API clients) are allowed; they
  cannot carry SameSite cookies from a browser context.

## Approval gate (command execution)

`CommandExecutor` is the platform-level command path: `spawn(argv[0], argv.slice(1), { shell: false })`
holds for every execution. Key properties:

- No shell: arguments are never concatenated into a shell string, so there is no shell-injection
  surface.
- Risk classification happens before execution (`risk.ts`):
  - A hard set (`MUST_APPROVE_COMMANDS`) — `sudo`, `rm`, `mount`/`umount`, `diskutil`, `kill`
    family, `dd`, `mkfs`, `fdisk`, `launchctl`, `iptables`, `passwd`, and others — always
    requires approval regardless of the agent's policy and cannot be overridden by an allow-rule.
  - Recursive/force removal flags (`-r`/`-f` combined) classify removals as high risk.
  - `git reset`/`clean` and `git push` are treated as high risk.
  - Clear reads (`ls`, `pwd`, `cat`, `git status`, …) are classified safe.
  - Allow-rules (`{ executable, args }`) are matched exactly (argv equality, executable by
    basename or realpath); no prefix matching.
  - Under `always_require_approval`, every command requires approval.
- Approval decisions are recorded with reviewer and note, written to `audit_logs`, and carried to
  the associated task (requeued on approval, failed on rejection). Approvals expire
  (default 24h via `AGENTOS_APPROVAL_TIMEOUT_MS`); expired approvals are treated as rejected.

Catalogs of executed commands are written to `command_logs` with the risk level and whether
approval was required.

## OpenCode (in-task) boundary

Tasks run the OpenCode CLI on a composed prompt. OpenCode has its own permission model: in
non-interactive mode a tool call that would need permission is **auto-rejected** (nothing
executes). This is the default even for a "high"-policy agent. Consequences:

- An agent can reason, read its assigned working directory, and reply; it cannot perform sensitive
  actions unless you extend OpenCode permissions (e.g. an `opencode.json` in the working directory
  granting specific tools within it).
- Sensitive actions should be surfaced as text; the platform-level approval flow is the sanctioned
  way to approve a specific action.
- Tool calls executed by OpenCode with broader permissions do **not** pass through
  `CommandExecutor`; keep any per-directory OpenCode permission scope as narrow as possible.

## Executable allowlist

Only binaries whose basename is `opencode` (or `opencode.exe`) are accepted as the model-executor
binary. A configured `AGENTOS_OPENCODE_PATH` or `opencode_path` setting pointing at any other
executable is ignored at run time (with a warning), so the worker cannot be made to execute an
unrelated binary with task prompts.

## Data at rest

- SQLite at `~/.agentos/agentos.db`. Keep `~/.agentos` mode 700 on a personal device.
- `AGENTOS_DATA_DIR` relocates data (e.g. to an encrypted volume).
- Do not expose the API to the public internet without a reverse proxy + HTTPS (Caddy/nginx) and a
  firewall. The default bind is `0.0.0.0` for LAN convenience, which also exposes the server on any
  network you are connected to; use `AGENTOS_HOST=127.0.0.1` when you do not need LAN access.

## Known limitations

- Single-user: one admin account. Rate limits and the forced password change mitigate brute force,
  but this is not a multi-tenant design.
- In the default architecture, a running task never pauses at `waiting_for_approval` on its own:
  tasks execute via the OpenCode CLI, and OpenCode either auto-rejects permission-gated tool calls
  or applies its own configured permissions. The platform-level approval state machine (pending →
  approved/rejected, expiry, task requeue/fail, audit, realtime events) is fully implemented,
  unit-tested, and API-tested.
- Cross-origin protection relies on the `SameSite=Strict` cookie plus the Origin check described
  above; there is no per-request CSRF token.

## Known dependency advisories

- `@fastify/static` (8.x, used to serve `client/dist`) has published advisories about route-guard
  bypass via encoded path separators. They require directory listing or a route guard around the
  static root; AgentOS serves only the built dashboard from `client/dist`, does not enable directory
  listing, and has no guarded routes under the static root, so the advisory is not reachable. An
  upgrade requires moving to `@fastify/static` 10.x, which needs Fastify 6 (a breaking, unplanned
  upgrade); this will be revisited when Fastify itself is upgraded.