# xeplr-monitor — api

The API (`@xeplr/base-apis`) with the monitor's routes, and the sign-in service (`@xeplr/auth`).

## Commands

| Command | Does |
|---|---|
| `npm run setup` | create both databases (`xeplr_monitor_auth`, `xeplr_monitor_api`), the sign-in tables, permissions and menus |
| `npm run start-auth` | the sign-in service, port 19401 — refuses to start without Redis or `REDIS_PREFIX` |
| `npm run start-api` | the API, port 19402 — runs `migrations/` on start |
| `npm run migrate:auth` | apply new `migrations-auth/*.sql`, then restart sign-in |
| `npm run db:encrypt` | redo the encrypted database connection |
| `npm run check-env` | check every required setting is present |
| `npm test` | the auth catalog test, and the real-systemd test (Linux) |

## Routes — `/api/monitor`, behind the auth gate

Each checks its own permission with `requireApi(name)`; the names are the `apis` rows in `migrations-auth/0006_monitor.sql`.

| Method | Path | Permission (`apis` row) | |
|---|---|---|---|
| GET | `/settings` | View monitor settings | `{ self }`: the API's own unit, which it will not stop or kill |
| GET | `/host` | View server statistics | the server itself (the Home page): `linux`, `host { name, os, kernel, arch, uptimeSeconds }`, `memory` in bytes, counted the way `free` counts it (`totalBytes`, `usedBytes`, `freeBytes`, `availableBytes`, `buffersBytes`, `cacheBytes`, `sharedBytes`, `swapTotalBytes`, `swapUsedBytes`), `cpu { cores, model, load, usePercent }`, `disks [{ device, mount, type, totalBytes, usedBytes, availableBytes }]` — from `/proc` and `statfs`, no sudo (`lib/host.js`) |
| GET | `/services` | List monitored services | every watched service with `status` and `processes` (see the root README) |
| POST | `/services` | Add a monitored service | `{ unit, label? }` — any systemd service on the server; 404 no such service, 409 already there |
| PATCH | `/services/:unit` | Edit a monitored service | `{ label?, unit? }`, changed in place |
| DELETE | `/services/:unit` | Remove a monitored service | stops watching it; the service is not touched |
| POST | `/services/:unit/start` \| `stop` \| `restart` \| `kill` | Start, stop, restart or kill a service | → `{ unit, status }` afterwards |
| GET | `/services/:unit/logs` | Read service logs | `?lines=` (max 5000) `&since=&until=` (ISO) `&grep=` `&level=warn\|error` → `{ lines }`, oldest first |
| GET | `/services/:unit/logs/live` | Follow service logs live | server-sent events; read with `authEventStream` (`EventSource` cannot send the token) |
| GET | `/audit` | Read the monitor audit log | `?limit=` → `{ entries }`, newest first |

Errors come back as `{ error }` with their status (`createApp`'s handler).

## Layout

| Path | What |
|---|---|
| `development.env` | every setting, for development — never committed (make it from `production.env.example`; see the root README) |
| `env.required.js` | the settings that must be present; the API refuses to start and names any that are missing |
| `app.js` | the Express app: the auth gate, and the routes |
| `routes/index.js` | `/health` (public), `/whoami`, and `/api/monitor` |
| `routes/monitor.js` | the monitor's routes, each with `requireApi` |
| `lib/systemd.js` | status, processes, start/stop/restart/kill, logs, following — `systemctl`, `journalctl`, cgroups and `/proc`, never a shell |
| `lib/host.js` | the server itself: memory, CPU, disks, uptime |
| `lib/services.js` | the watched services (`monitor_services`) and the audit log (`monitor_audit`) |
| `models/` | `MonitoredService`, `MonitorAudit` (`@xeplr/db` `BaseModel`) |
| `migrations/` | the monitor's tables |
| `migrations-auth/` | the Monitor menu row, the `apis` rows, their groups and role grants |
| `test/` | `npm test` |

## Settings to know

| Setting | |
|---|---|
| `MONITOR_CONTROL_COMMAND` | in production, `/usr/local/libexec/xeplr-monitor-control` (the deploy sets it): the one command sudoers allows. Unset in development, where `systemctl` is asked directly |
| `MONITOR_SUDO` | optional: `actions` (default) runs start/stop/restart/kill through `sudo -n`; `all` reads the journal through sudo too; `none` for root or polkit rights |
| `REDIS_PREFIX` | **required, unique to this app** (`xeplr-monitor:`) |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | where Redis is |
| `XEPLR_MONITOR_CONNECTION`, `AUTH_DB_CONNECTION_INFO_ENCRYPTED` | the database, encrypted — `npm run db:encrypt` |
| `DB_API`, `AUTH_DB_NAME` | the two database names — never guessed |
| `LOG_DIR` | absolute in production (`/var/lib/xeplr-monitor/logs`) |
| `AUTH_SUPER_ADMIN_EMAIL` / `_PASSWORD` | the first account — created once, when the sign-in database is first set up |
| `AUTH_ACTIVATION_URL`, `AUTH_INVITE_URL`, `AUTH_RESET_URL` | the UI pages the emailed links open |
| `AUTH_REGISTER_ROLES` | the role a new sign-up gets (`Viewer`). Registration needs email (`EMAIL_PROVIDER`); without it, people are added by an admin |
