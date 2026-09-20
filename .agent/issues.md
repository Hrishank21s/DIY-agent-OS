# Known issues (append-only; status per issue)

## I-01 npm allow-scripts blocks esbuild/fsevents postinstall
- added: 2026-09-20T12:39:05Z
- status: open (non-blocking)
- impact: `npm install` prints warnings that esbuild@0.28.2/0.25.12 and
  fsevents postinstall scripts are not approved.
- context: esbuild works anyway because platform binaries ship as optional
  deps (@esbuild/darwin-*, etc.); no functional impact seen. Resolve by
  approving the scripts or configuring allow-scripts in .npmrc.
- evidence: `npm install` output during the audit session.

## I-02 Lockout failure count is per-username, not per-IP
- added: 2026-09-20T12:39:05Z
- status: accepted as designed
- impact: a distributed attacker rotating IPs but using one username is still
  covered (count is per username); a single-PI attacker hitting many usernames
  is not blocked per-IP.
- context: per-username was chosen because usernames are few and the rate limiter
  (login_rate_limit) already keys per-IP at the route layer. Revisit if
  multi-user/team support lands (roadmap).

## I-03 @fastify/static 8.x advisory (documented, unreachable)
- added: 2026-09-20T12:39:05Z
- status: open (documented mitigation)
- impact: Published path-traversal advisories require directory listing or a
  route guard around the static root; AgentOS serves only built assets from
  client/dist, listing is disabled, and an onRequest guard rejects `..` and
  `%2e%2e` outside /api/.
- context: full mitigation/upgrade requires @fastify/static 10.x → Fastify 6
  (breaking, unplanned). Revisit when Fastify is upgraded. See docs/SECURITY.md.

## I-04 Bootstrap admin password printed to stdout on first boot
- added: 2026-09-20T12:39:05Z
- status: by design
- impact: the one-time bootstrap password is visible in the server console/log.
- context: shown once; user is forced to change it at first login
  (PASSWORD_CHANGE_REQUIRED gate). Treat the boot log as sensitive until rotated.
