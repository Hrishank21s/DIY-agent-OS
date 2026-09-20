# Decisions (append-only)

## 2026-09-20T12:39:05Z — D01 Loopback bind default
Decision: Default `AGENTOS_HOST` to `127.0.0.1`; bind `0.0.0.0` only when the user
opts into LAN access.
Reason: Secure-by-default — a server bound to 0.0.0.0 is reachable from every
network the machine is on. Env, seed data, CLI status/doctor, and all docs now
reflect loopback default.
Do not casually revert to a non-loopback default without a config knob and docs.

## 2026-09-20T12:39:05Z — D02 Trust proxy as hop count, disabled by default
Decision: `AGENTOS_TRUST_PROXY` accepts a hop count; bare `true` = 1 hop;
`false`/`0`/unset disables X-Forwarded-* handling entirely.
Reason: An unbounded `true` behind an open proxy chain lets a client rotate
X-Forwarded-For to defeat rate limits. Counting hops limits misuse to the nearest
trusted local proxy.
Do not casually revert to an unbounded boolean trust.

## 2026-09-20T12:39:05Z — D03 Basename risk classification
Decision: Risk classification and the mandatory-approval gate match on the command
basename (with basename+realpath rule matching).
Reason: Raw argv[0] matching let `/bin/rm`, `/usr/bin/sudo`, `/tmp/evil-rm`
classify as low/flat, bypassing the hard approval gate.
Do not revert to full-path matching without equivalent normalization.

## 2026-09-20T12:39:05Z — D04 one_time automations never re-armed
Decision: Past-target one_time schedules store NULL next_run_at on create/update;
fired one_time automations set next_run_at NULL after trigger.
Reason: computeNext on a past one_time timestamp armed the same past instant and
the 10s scheduler poll re-triggered it forever.
Do not re-allow re-arming a past one_time target.

## 2026-09-20T12:39:05Z — D05 Approvals get() read-only
Decision: `ApprovalService.get()` never mutates; expiry only via explicit
`expireStale()`.
Reason: get() previously expired rows on read, making GET endpoints side-effecting
and turning reads into writes.
Do not reintroduce write-on-read.

## 2026-09-20T12:39:05Z — D06 Settings enforced at run time
Decision: approval_rules, login_rate_limit, session_rate_limit,
login_failed_attempts, login_lockout_minutes, memory_importance_threshold,
task_timeout_ms are read from the settings table at enforcement points, not just
stored.
Reason: a security settings panel that is not enforced is a false sense of security.
Do not make these knobs advisory again.

## 2026-09-20T12:39:05Z — D07 scrypt N=65536 for new hashes
Decision: New password hashes use N=65536, r=8, p=1, maxmem 128MB; verify derives
maxmem from the stored N so legacy N=32768 hashes still verify.
Reason: stronger KDF without breaking existing accounts.
Do not lower below N=65536 for new hashes.

## 2026-09-20T12:39:05Z — D08 Timing-equalized login + lockout
Decision: login() verifies against a precomputed dummy scrypt hash when the
username is missing; lockout is checked before verification work; failures land in
`login_attempts` (migration 003).
Reason: timing / account-enumeration side-channel; brute-force persistence.
Do not revert to fast-fail on unknown username.

## 2026-09-20T12:39:05Z — D09 Drop @fastify/websocket + @fastify/csrf-protection
Decision: Removed both deps and the register calls. Realtime is SSE; CSRF defense
is SameSite=Strict + Origin allow-list.
Reason: @fastify/websocket was dead code (no WS route existed).
Do not re-add a WebSocket transport without a route that uses it.

## 2026-09-20T12:39:05Z — D10 Helmet CSP vs plain HTTP
Decision: When `cookieSecure` is false, register helmet with
`contentSecurityPolicy: false` and emit a hand-written CSP header that omits
`upgrade-insecure-requests`.
Reason: helmet's default CSP includes `upgrade-insecure-requests`, which makes a
plain-HTTP-served dashboard render blank (every resource rewritten to https).
Do not re-enable helmet's default CSP for non-secure serving.

## 2026-09-20T12:39:05Z — D11 Commit .agent/ to the repo
Decision: The project-continuity checkpoint lives in `./.agent/` and is committed
to git.
Reason: durable, cloneable, machine-independent continuity; the secrets policy
guarantees no credentials are stored. `.agent` is not in .gitignore (only
`.agentos-data/` is), so it is tracked by default.
Do not move `.agent/` elsewhere without keeping git tracking.
