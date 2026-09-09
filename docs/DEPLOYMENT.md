# Deployment

## Dependencies

- Node.js >= 22 (tested on 26) with built-in `node:sqlite`
- The OpenCode CLI, discoverable on `PATH` as `opencode` (or set `opencode_path` in settings)
- A model provider for OpenCode (e.g. `opencode/big-pickle`) — the model is configurable per agent

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

First login: `admin` / `admin123`, then change the password immediately.

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

If macOS Firewall prompts, allow Node to accept incoming connections. To disable LAN access,
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
| `AGENTOS_OPENCODE_PATH` | from PATH | Absolute path to the opencode binary |

Agent/policy/model/timeout/cron settings are stored per agent in the dashboard (`Settings` page)
and persist in the database.