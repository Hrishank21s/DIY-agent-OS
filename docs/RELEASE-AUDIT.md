# Release audit & hardening report

Scope: architecture review and security-hardening pass prior to a public release, performed
alongside the fixes described below. Every statement here has been verified against the code in
this repository at the time of writing.

## Verification status

| Check | Result |
| --- | --- |
| Server tests (`npm run test -w server`) | 91 passing across 10 files |
| Client tests (`npm run test -w client`) | 9 passing across 3 files |
| Typecheck (`npm run typecheck`, both workspaces) | clean |
| Lint (`npm run lint`, both workspaces) | clean, 0 warnings/errors |
| Build (`npm run build`) | clean (server tsc + client vite) |
| `npm audit` | 1 high advisory (documented non-reachable, see below) |

## Changes made in this pass

1. **Bootstrap credentials** (`server/src/db/seed.ts`, `server/src/config.ts`)
   - Credentials resolve from `AGENTOS_BOOTSTRAP_USERNAME` / `AGENTOS_BOOTSTRAP_PASSWORD`.
   - Production refuses passwords shorter than 8 chars or in a built-in weak list; a strong random
     password is generated and printed once to the console (also for `agentos reset-admin`).
   - The bootstrap account always starts with `must_change_password = 1`.

2. **Forced password change enforcement** (`server/src/middleware/auth.ts`)
   - All routes except a small whitelist (`/auth/me`, `/auth/change-password`, `/auth/logout`)
     return `403 code=PASSWORD_CHANGE_REQUIRED` until the password is changed.
   - The dashboard redirects to `/force-password-change` on that code.

3. **Password change revocation** (`server/src/services/auth.ts`)
   - Changing or resetting a password revokes session tokens; the session issuing the change is
     kept when it presented its own current password.

4. **Session/CSP/proxy hardening** (`server/src/index.ts`, `server/src/config.ts`)
   - Session cookies are `httpOnly`, `SameSite=Strict`, `secure` in production mode.
   - Content-Security-Policy (Helmet) is always enabled.
   - `AGENTOS_TRUST_PROXY` must be set explicitly before `X-Forwarded-*` headers are trusted.
   - Origin check on state-changing requests: only loopback origins or configured
     `AGENTOS_PUBLIC_ORIGIN` / `AGENTOS_TRUSTED_ORIGINS` are accepted; the request `Host` is never
     used; requests without an `Origin` (non-browser clients) are allowed.

5. **Approval lifecycle** (`server/src/services/approvals.ts`, `command.ts`, `index.ts`)
   - Approvals carry an expiry (`AGENTOS_APPROVAL_TIMEOUT_MS`, default 24h); expired approvals are
     lazily expired, swept at boot (failing associated tasks), and stored as rejected.
   - `waitForApproval` is event-driven over the in-process realtime hub (no polling); `respond()`
     and expiry emit the event.
   - Double-respond is guarded (`{ approval, changed }`); task state is only reconciled when
     changed.
   - Approval policy renamed to `always_require_approval` (legacy `always_approve` still accepted
     and normalized). Seeds, schemas, and docs updated; migration `002` backfills.

6. **Command risk policy** (`server/src/services/risk.ts`)
   - Catastrophic commands (`sudo`, `rm`, `diskutil`, `kill`, … = `MUST_APPROVE_COMMANDS`) always
     require approval and cannot be overridden by allow-rules.
   - Allow-rules are structured `{ executable, args }` with exact argv equality (no prefix
     matching); executable matched by exact path, basename, or realpath.

7. **Chat IDOR** (`server/src/services/chat.ts`, `routes/chat.ts`)
   - Conversations are scoped via `getOwnedConversation(id, userId)`; foreign-user reads/writes on
     conversation messages/PATCH/DELETE return 404.

8. **SSE authentication** (`routes/realtime.ts`)
   - Removed the `?token=` query fallback; the realtime channel is cookie-only.

9. **Executor allowlist** (`server/src/executors/opencode.ts`, `config.ts`)
   - Only binaries basename'd `opencode` (or `opencode.exe`) are executed; misconfigured
     `AGENTOS_OPENCODE_PATH` / `opencode_path` pointing elsewhere are ignored with a warning.

10. **Migration corrections** (`server/migrations/001_init.sql`, new `002`)
    - `projects` table dependency ordering fixed; seed agents default to
      `always_require_approval`; `002` adds `approvals.expires_at` + 24h backfill and migrates the
      legacy policy value.

11. **Docs truthfulness** (`README.md`, `docs/{ARCHITECTURE,SECURITY,DEPLOYMENT,DEVELOPMENT}.md`)
    - Removed the unverifiable `admin/admin123` default claim, the `ALWAYS_APPROVE_COMMANDS` stale
      catalog, false CSRF/“polls”/E2E-script claims, the magic e2e path (`/tmp/agentos-e2e.sh`,
      which is not part of the repo), and the stale “61 tests” counts.
    - Docs now describe the real task path: worker → OpenCode CLI, with OpenCode's own permission
      model governing model tool calls, and the platform approval gate as the integration-facing
      command boundary (fully implemented and tested at service/API level).

12. **Dependency advisories (Phase: client)**
    - `react-router-dom` upgraded `6.26 → 7.18.3` (CVE-2025-68470 fixed).
    - `vite` upgraded `5.4 → 6.4.3` and `vitest` `2.1 → 4.1.11` (esbuild/mocker advisories fixed).
    - Removed a mis-sited `@vitest/mocker` direct dependency; `vite` lifted to the repo root so the
      dashboard toolchain shares one copy.
    - `@fastify/static` (server, version 8.x) remains: fixing its advisories requires version 10.x,
      which requires Fastify 6. Assessment: not reachable — no directory listing, no route guards
      around the static root, and only the built dashboard is served. Tracked as a required task
      when Fastify is next upgraded.

## Residual risks

- Single-user design; not multi-tenant. Rate limiting + forced password change mitigate brute force.
- In the default architecture a running task never pauses at `waiting_for_approval` on its own;
  approval-gated commands are created by integrations/tests via `CommandExecutor`. OpenCode's own
  permission system governs model tool calls (auto-reject in non-interactive mode).
- Origin checks compare against configured values; a missing `Origin` header is accepted (needed
  for non-browser clients). Primary CSRF defense is the `SameSite=Strict` cookie.
- Production TLS is expected at a reverse proxy; over plain HTTP LAN the server is only as secure
  as the network.

## Artifacts

- Internal plan/order of operations: `/var/folders/4s/3btqtx9n3f12_0r97czmx4fw0000gn/T/opencode/agentos-plan.md`
- This report: `docs/RELEASE-AUDIT.md`