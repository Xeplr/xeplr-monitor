# xeplr-monitor

See and control a server's services from a web page: whether each one is running and how it is doing (memory against its limit, CPU, threads, every process of it, restarts, why it last stopped, what command it runs), start, stop, restart or kill it, and read its log, live or for a time range, with a search box.

It is a xeplr app, made with [`@xeplr/cli`](https://www.npmjs.com/package/@xeplr/cli): sign-in, users, roles and the permission catalog are [`@xeplr/auth`](https://www.npmjs.com/package/@xeplr/auth) with its own database; the monitor's own tables are in a second database through [`@xeplr/db`](https://www.npmjs.com/package/@xeplr/db); the page is [`@xeplr/ui-monitor`](https://www.npmjs.com/package/@xeplr/ui-monitor) inside a [`@xeplr/ui-account`](https://www.npmjs.com/package/@xeplr/ui-account) shell.

```
xeplr-monitor/
├─ api/        the API (routes/monitor.js) and the sign-in service      → api/README.md
├─ ui/         the React app: the Monitor page                          → ui/README.md
├─ deploy/     deploy.js (run on your laptop) and install.sh (run on the server)
└─ CLAUDE.md   how to change this app
```

**What it needs to be running:** PostgreSQL and Redis. If either is down, sign-in is too, so the monitor cannot be used to restart those two; everything else it can.

## How it works

The apps on our servers run as systemd services (`xeplr-bi-api`, `-auth`, `-jobs`; testbi's `xeplr-bi-dev-*`). The monitor starts nothing itself: it asks `systemctl`, the same way the deploy does, and reads the journal.

```
browser ──https──▶ nginx ─┬─ /auth/api/ ─▶ xeplr-monitor-auth  (sign-in, port 19401)
                          ├─ /api/      ─▶ xeplr-monitor-api   (port 19402, its own user)
                          │                  ├─ systemctl show                  status (no sudo)
                          │                  ├─ sudo -n xeplr-monitor-control start|stop|restart|kill <unit>
                          │                  ├─ journalctl -u … -o json [-f]    logs (systemd-journal group)
                          │                  └─ /sys/fs/cgroup, /proc            its processes
                          └─ /          ─▶ ui/dist (the page)
```

- A service is controlled only once someone has **added it** (a row in `monitor_services`) and only if its name matches **`MONITOR_ALLOW`** (e.g. `xeplr-*`). **sudoers allows one command and nothing else**: `/usr/local/libexec/xeplr-monitor-control` (`deploy/control.sh`, root-owned), which takes exactly an action of the four and one plain service name, checks the name against `MONITOR_ALLOW` itself, and only then runs `systemctl`. No wildcard in sudoers: newer sudo (`sudo-rs`, Ubuntu's default) refuses one in command arguments, and in classic sudo a `*` also matched spaces.
- Names are checked (`[A-Za-z0-9@._:-]`) before they reach a command. No shell is ever used.
- **Stop and kill refuse the monitor's own API service**, which it finds from its cgroup. Restart is allowed.
- A live log is one `journalctl -f` per open log, ended when the page closes it. At most 10 per person.
- Every change, refused ones too, is a row in `monitor_audit`: who, from where, what, on which service, whether it worked.

## Who may do what

Each route checks its own permission (`requireApi` from `@xeplr/base-apis`) against the `apis` rows in `api/migrations-auth/0006_monitor.sql`. Starting grants, changed in the app under **Admin**:

| Group | Routes | Roles |
|---|---|---|
| `monitor:view` | settings, the services with their status and processes, logs, live logs | Super Admin, CompanyAdmin, Admin, Editor, Creator, Viewer |
| `monitor:control` | start, stop, restart, kill | Super Admin, CompanyAdmin, Admin, Editor |
| `monitor:manage` | add, edit, remove a watched service | Super Admin, CompanyAdmin, Admin |
| `monitor:audit` | the audit log | Super Admin, CompanyAdmin, Admin |

A route somebody's roles do not include answers 403, and the page says so.

## How a service is doing

Read without sudo, every time the list is asked for (the page asks every 5 seconds):

| | From |
|---|---|
| State, since when, why it last ended, exit code, restarts | `systemctl show`: `ActiveState`, `SubState`, `Result`, `ExecMainStatus`, `NRestarts` |
| **What runs it**: command line, working folder, user, unit file | `ExecStart`, `WorkingDirectory`, `User`, `FragmentPath` — the command `ps` shows; an environment file's contents are never read |
| **Memory** now, peak, limit, swap | `MemoryCurrent`, `MemoryPeak` (systemd 255+), `MemoryMax`, `MemoryHigh`, `MemorySwapCurrent` |
| **CPU %** since the last reading | `CPUUsageNSec`, two readings apart (above 100% is more than one core) |
| Threads, against `TasksMax` | `TasksCurrent` |
| **Every process**: pid, parent, command, memory, swap, CPU %, threads, state, running since | the unit's cgroup, then `/proc/<pid>/stat`, `status`, `cmdline` (at most 200, main first) |

The page turns these into a **needs a look** list: memory at 90% of its limit or past `MemoryHigh`, restarts, swap in use, threads near their cap, CPU at 90%+, processes stuck on disk or network (`D`) or zombies (`Z`).

## Deploy to a server, from your laptop

```bash
npx -y github:Xeplr/xeplr-monitor                  # the latest main
npx -y github:Xeplr/xeplr-monitor --ref v1.0.0     # a tag
node deploy/deploy.js --source .                   # from a checkout: its committed HEAD
```

It asks for what it needs as it goes and stores nothing — not in this public repository, not on your laptop:

- **The server:** host (or a `~/.ssh/config` name), SSH login, port, key file. The same SSH access BI's deploy uses; the login needs **passwordless sudo**.
- **The monitor:** which version, its ports (19400: sign-in on 19401, the API on 19402), which services it may control (`MONITOR_ALLOW`).
- **Postgres and Redis** it uses: host, port, user, and the passwords (hidden). The Postgres user must be allowed to create databases. On a re-deploy, an empty database host keeps the login set before.
- **The Super Admin:** email and password (hidden, twice; empty keeps the one set before). More people are added in the app.
- **Its web address** for nginx (optional), with an https certificate from certbot.

Then it shows what it will do, asks to confirm, and runs `deploy/install.sh` on the server as root, sent on SSH's input — no value is a file or a command-line argument there. The install:

1. makes the `xeplr-monitor` user (in `systemd-journal`) and `/var/lib/xeplr-monitor/logs`;
2. puts the release in `/opt/xeplr-monitor/releases/<time>`: the source (fetched from GitHub, or sent from your checkout), `npm ci` in `api/` and `ui/`, and the page built;
3. writes `/opt/xeplr-monitor/shared/production.env` (`deploy/settings.cjs`, 640): **`ENCRYPTION_KEY` and `AUTH_JWT_SECRET` are made on the server the first time and kept on every later deploy**, so nobody is signed out; the database login is encrypted with `@xeplr/utils`;
4. creates the two databases if missing and runs the sign-in migrations (users, roles, the monitor's permissions);
5. installs the control command with `MONITOR_ALLOW` in it and writes `/etc/sudoers.d/xeplr-monitor` naming that command alone (checked with `visudo` first), then checks the monitor's user can ask systemd (D-Bus);
6. switches `/opt/xeplr-monitor/current` to the new release and (re)starts `xeplr-monitor-auth` and `xeplr-monitor-api`, checking both answer — or shows their last log lines;
7. keeps the newest three releases;
8. with a web address: writes the nginx site, checks it with `nginx -t`, reloads, and runs certbot when asked.

Every value except the passwords can be given as an argument (`--help` lists them); the passwords can come from `XM_DB_PASSWORD`, `XM_REDIS_PASSWORD`, `XM_ADMIN_PASSWORD` for a script. It stops, saying why, when SSH sign-in fails, sudo needs a password, Node.js 20+ or npm is missing, the source cannot be fetched, Postgres refuses, systemd or D-Bus is missing, sudoers is invalid, a service does not answer, or nginx refuses the site.

Keep the ports closed in the firewall (our security group allows only 22, 80 and 443): nginx is the way in.

## Run it locally

Needs **PostgreSQL** and **Redis** running. The controls work only on Linux with systemd; on a Mac the page runs and says so.

```bash
cd api && cp production.env.example development.env
# in development.env: NODE_ENV=development, LOG_DIR=./logs,
#   ENCRYPTION_KEY and AUTH_JWT_SECRET (each: openssl rand -hex 32),
#   AUTH_SUPER_ADMIN_EMAIL / _PASSWORD, the AUTH_*_URL addresses on http://localhost:19400
npm install && npm run db:encrypt && npm run setup
npm run start-auth     # sign-in      http://localhost:19401
npm run start-api      # the API      http://localhost:19402
cd ../ui && npm install && npm run dev     # the app   http://localhost:19400
```

Open http://localhost:19400 and sign in as the Super Admin.

## Tests

```bash
cd api && npm test
```

- `test/apiRoleMappings.test.cjs` — the auth catalog built from `migrations-auth`: every route `routes/monitor.js` checks has its `apis` row, every row a group, every group a role besides Super Admin, and the Monitor menu row is the key the side rail uses.
- `test/systemd.test.cjs` — `lib/systemd` against a real systemd: a small unit written into `/run/systemd/system`, then read (what runs it, memory against its limit, CPU %, its processes), followed, searched, restarted, killed, stopped and started; and `deploy/control.sh` through sudo — refusing a service `MONITOR_ALLOW` does not name, a name that is not plain, an option, another action, a second name — then starting, restarting, killing and stopping an allowed one. Needs Linux with systemd and passwordless sudo — GitHub's ubuntu runners have both, so CI runs it; elsewhere it is skipped and says why.

**systemd 255** (Ubuntu 24.04) kills a service and then reports it could not signal its "auxiliary processes", even when it has none. A kill is treated as done when the service really went down.

## Rules this app follows

| Rule | Why |
|---|---|
| Every route checks its own permission, and has its `apis` row, group and role grants in `migrations-auth`, in the same change. | The catalog is the only place that says who can reach a URL. |
| The control command checks `MONITOR_ALLOW` again, as root; sudoers allows only it. | Even a bug in the API cannot reach another unit. |
| The monitor's tables are real tables (`monitor_services`, `monitor_audit`). | Who watched what and who did what are queries. |
| No setting for where data lives is defaulted; folders are absolute. | A wrong-but-present value reads as empty data, not as an error. |
| **`REDIS_PREFIX`** is `xeplr-monitor:`. | Apps sharing a Redis would otherwise serve each other's sessions. |
| Every data address is under **`/api`**. | A page and a data path never collide. |
