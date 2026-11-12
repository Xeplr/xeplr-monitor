# xeplr-monitor

A xeplr app (made with `@xeplr/cli`): `api/` (Node, `@xeplr/base-apis`, sign-in by `@xeplr/auth`) and `ui/` (React + Vite, `@xeplr/ui-account`). It shows the server itself (**Home**: memory in GB, CPU, disks, uptime) and shows and controls its systemd services (**Monitor**). Both pages are `@xeplr/ui-monitor`'s (`ServerPage`, `MonitorPage`). The sample forms and flows the CLI generates were removed.

Read README.md first: how it works, who may do what, the deploy.

## Where things are

| Change | Where |
|---|---|
| a route | `api/routes/monitor.js` — with `requireApi('<name>')`, AND the `apis` row (name, group) plus its role grants in a new `api/migrations-auth/000N_*.sql`, in the same change. Add the name to the `API` map; `api/test/apiRoleMappings.test.cjs` fails otherwise |
| how a service is read or controlled | `api/lib/systemd.js` (never a shell: argument lists only, names checked by `unitName`) |
| the server's own numbers (Home) | `api/lib/host.js` (`/proc`, `statfs` — the numbers `free` and `df` show) |
| the watched services, the audit log | `api/lib/services.js`, `api/models/`, a new `api/migrations/000N_*.sql` (never edit an applied one) |
| what the page shows or does | `@xeplr/ui-monitor` (its own repo: model, controllers, designs) — not here. This app only mounts it (`ui/src/pages/Monitor.jsx`) |
| a side-rail item | `ui/src/App.jsx` `drawerItems` by **key**, with an icon and a path, and its `menus` row in `migrations-auth` (the same key, exactly — unknown keys are dropped silently) |
| production settings | `deploy/settings.cjs` (what the server's `production.env` holds) and `api/production.env.example` (every name, no values) — keep them the same |
| the install on a server | `deploy/install.sh` (as root, on the server) and `deploy/deploy.js` (the questions, on a laptop) |

## Rules

- **Every route has its `apis` row, group and role grants in the same change.** Super Admin and CompanyAdmin get everything; Admin everything; Editor view + control; Creator and Viewer view.
- **sudoers allows one command**, `deploy/control.sh` installed as `/usr/local/libexec/xeplr-monitor-control`, which checks the action and the name itself. Which services a person may control is decided by their roles, not by a pattern: any service on the server can be added. Never a wildcard in sudoers (sudo-rs refuses it; classic sudo's `*` matches spaces).
- **Use the xeplr packages; never a local copy.** Something a package lacks is added to that package and released first (e.g. `requireApi` in `@xeplr/base-apis`, `authEventStream` in `@xeplr/ui-account`).
- **The Monitor page is web only** (`ui/pages.json`, with the reason). Before writing any other page by hand, say so and ask whether it should be a screen instead.
- No database name, storage folder or other "where data lives" setting is defaulted; folders are absolute.
- Every data address is under `/api`.
- `authFetch` returns the parsed body, not a Response; a live stream is `authEventStream`.
- Tests are real: `api/test/systemd.test.cjs` runs against a real systemd (CI's ubuntu runner, or a systemd container); the deploy is checked against a real server (systemd, sshd, Postgres, Redis, nginx).
