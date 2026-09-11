# Contributing to AgentOS

Thanks for your interest in contributing! This project is small, opinionated, and single-user by
design — please keep that spirit in mind when proposing changes.

## Code of Conduct

Be kind, be constructive, and assume good faith. This project has no governing body; treat your
fellow contributors how you'd like to be treated.

## Before you start

**Open an issue first.** Describe the change you want to make, why it matters, and roughly how
you'd implement it. Wait for maintainer feedback before investing hours into a big PR — this
keeps scope tight and avoids wasted work.

## Getting started

```bash
npm install
npm run build
npm run dev       # server + client with hot reload
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full development guide, test isolation
notes, and determinism details.

## Branching & PR flow

1. Fork the repo and clone your fork.
2. Create a feature branch: `git checkout -b feat/my-change`
3. Make your changes. Keep them small and focused.
4. Run the checks below.
5. Push and open a pull request against `main`.
6. In the PR description, reference the issue you opened and summarize what changed and why.

## Checks that must pass

```bash
npm run typecheck   # tsc --noEmit on server + client
npm run lint        # eslint on server + client
npm test            # 89 server tests + 9 client tests
```

If any of these fail, the PR will not be merged.

## Key behaviors to preserve

These are invariants with security implications. **Breaking any of them will block a merge:**

- **Never introduce a shell into command execution.** The command executor spawns argv arrays
  with `shell: false`. New commands go through `server/src/services/risk.ts` classification,
  never through a shell string.
- **Do not weaken the approval gate.** `sudo`, `rm`, `mount`, `diskutil`, `kill`, `dd`, `mkfs`,
  and friends must always require human approval and cannot be bypassed by allow-rules.
- **Do not break the double-execution guard.** The task queue claims with an exclusion set of
  running task ids. If you add new ways to requeue in-flight tasks, extend the exclusion set.
- **Keep the approval enum strict**: `safe | low | medium | high | always_require_approval`.
- **Use `node:sqlite` and `crypto` primitives only.** Native modules may not compile on the
  target Node versions.
- **Emit server-side events through the realtime hub** best-effort — never let a missing socket
  crash the request path.

## Code style

- TypeScript, strict mode, in both `server/` and `client/`.
- Follow the existing formatting conventions (2-space indent, no semicolons in new code is fine,
  but be consistent with surrounding code).
- No comments unless they explain *why*, not *what*.
- Tests live next to what they cover (`*.test.ts`, `*.test.tsx`).

## Committing

Keep commits atomic and messages imperative, e.g.:

- `feat: add dockerfile for containerized deployment`
- `fix: honor AGENTOS_PORT in launchd helper`
- `docs: clarify approval expiry semantics`

## Reporting bugs

Use the [Bug report](.github/ISSUE_TEMPLATE/bug_report.yml) template. Include:

- What you expected vs. what happened
- Node version, macOS version, and whether you're on Apple Silicon
- The `npm run doctor` output if available
- Steps to reproduce

## Security issues

Do **not** open a public issue for security vulnerabilities. Email the maintainer directly or
open a GitHub Security Advisory. See [docs/SECURITY.md](docs/SECURITY.md) for what's covered.