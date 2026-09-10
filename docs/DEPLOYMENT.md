# Deployment

## Dependencies

- Node.js >= 22 (tested on 26) with built-in `node:sqlite`
- The OpenCode CLI, discoverable on `PATH` as `opencode` (or set `opencode_path` in settings)
- A model provider for OpenCode (e.g. `opencode/big-pickle`) — the model is configurable per agent

Only binaries named `opencode` are accepted as the executor; a path with any other basename is
ignored at runtime (see SECURITY.md).

Check everything with the doctor:

```bash
npm run doctor
```

## From scratch

```bash
npm install          # installs workspaces, builds the client (postinstall)
npm run build        # type-check + compile server, build client
npm run start        # server on http://localhost:3000 (or :3000 on LAN)
```

On first start the server seeds the bootstrap user. Set `AGENTOS_BOOTSTRAP_USERNAME` / 
`AGENTOS_BOOTSTRAP_PASSWORD` to choose credentials; otherwise a strong random password is
generated and **printed once to the server console**. The first login forces a password change.

In production, `AGENTOS_BOOTSTRAP_PASSWORD` must be at least 8 characters and not a known weak
password; weak or missing bootstrap passwords are refused in favor of the generated one.

## Development

```bash
npm run dev          # both server (tsx watch) and client (Vite) with reload
```

Client dev server proxies `/api` and `/realtime` to `http://localhost:3000`.

## Database

- Location: `~/.agentos/agentos.db` (default), configurable via `AGENTOS_DATA_DIR` to point at an
  encrypted volume, a USB disk, or a different user profile.
- Migrations run automatically at server start (`db/migrate.ts`); run them explicitly with
  `npm run migrate`.
- Back up by stopping the server and copying the data dir. SQLite is a single file, so
  `cp ~/.agentos/agentos.db backups/$(date +%F).db` is a valid backup.

## LAN access

The server already binds `0.0.0.0`. From another device:

```
http://<your-mac-ip>:3000
```

State-changing requests are only accepted from loopback origins or origins explicitly configured
via `AGENTOS_PUBLIC_ORIGIN` / `AGENTOS_TRUSTED_ORIGINS` (see SECURITY.md → Cross-origin
protection). For LAN browser access, set the origin you will actually use:

```
AGENTOS_PUBLIC_ORIGIN=http://<your-mac-ip>:3000
```

The server also logs a warning at startup if it binds a non-loopback host without a configured
origin. If macOS Firewall prompts, allow Node to accept incoming connections. To disable LAN access,
start with `AGENTOS_HOST=127.0.0.1`.

## Reverse proxy (HTTPS, optional but recommended for LAN/WAN)

Caddy example:

```
agentos.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Keep the port bound to loopback (`AGENTOS_HOST=127.0.0.1`) when behind a proxy.

## Auto-start at login (launchd)

```bash
scripts/install-launchd.sh    # installs com.agentos.server (starts on login)
scripts/status.sh             # current launchd state
scripts/uninstall-launchd.sh  # remove it
```

The plist runs the built server with logs at `~/Library/Logs/agentos-server.log` and
`~/.agentos/*.log` style rotation. If `opencode` is not on launchd's PATH, set the
`AGENTOS_OPENCODE_PATH` env var (the plist supports it) or use an absolute path in settings.

## Restart behavior

- Stale `running` tasks → marked `failed` ("Server restarted while task was in progress").
- Stale `waiting_for_approval` tasks → marked `paused`; approving them afterwards requeues and
  runs them.
- In-flight OpenCode subprocesses are not killed by the launchd job automatically; orphaned CLI
  processes are harmless (they cannot write anything they were not already allowed to).

## Config surface (env)

| Env var | Default | Meaning |
| --- | --- | --- |
| `AGENTOS_HOST` | `0.0.0.0` | Bind host |
| `AGENTOS_PORT` | `3000` | Port |
| `AGENTOS_DATA_DIR` | `~/.agentos` | Data root (contains `agentos.db`) |
| `AGENTOS_OPENCODE_PATH` | from PATH | Absolute path to the `opencode` binary |
| `AGENTOS_BOOTSTRAP_USERNAME` | `admin` | Bootstrap username |
| `AGENTOS_BOOTSTRAP_PASSWORD` | — | Bootstrap password (random + printed once if unset/weak in production) |
| `AGENTOS_RUNTIME_MODE` | prod unless `NODE_ENV`/`test` | `development` disables secure-only cookies |
| `AGENTOS_TRUST_PROXY` | `false` | `true`/`1` trusts the reverse proxy for `X-Forwarded-*` |
| `AGENTOS_PUBLIC_ORIGIN` | — | Public origin allowed for browser state-changing requests (required for non-loopback access, e.g. LAN) |
| `AGENTOS_TRUSTED_ORIGINS` | — | Comma-separated extra origins allowed for browser requests |
| `AGENTOS_APPROVAL_TIMEOUT_MS` | `86400000` | Approval expiry window (24h) |
| `AGENTOS_SESSION_MINUTES` | `480` | Session lifetime |
| `AGENTOS_WORKDIR` | `~/Projects` | Default working directory |
| `AGENTOS_CONCURRENCY` | `2` | Worker concurrency |
| `AGENTOS_TASK_TIMEOUT_MS` | `600000` | Per-task timeout |

Agent/policy/model/timeout/cron settings are stored per agent in the dashboard (`Settings` page)
and persist in the database.