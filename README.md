# @xeplr/monitor

See and control a server's services from a web page: whether each one is running and how healthy it is (memory against its limit, CPU, threads, every process of it, restarts, why it last stopped, and what command it runs). Start, stop, restart or kill it, and read its log, either live as it is written or for a time range, with a search box.

It is what you open when something is down, so it depends on nothing else:

- **Its own sign-in.** It does not use `@xeplr/auth`. If BI's auth service is the one that crashed, a monitor that signed in through it could not be used to restart it.
- **No database.** Users, the services it watches and its audit log are plain files in one folder. It keeps working when Postgres is down.
- **Built on the xeplr packages, none of which needs a running service here:** `@xeplr/base-apis` `createApp` (the gate, cookies, request lines through `@xeplr/logs` to stdout and so to the journal, where the monitor can show its own log; in production only 4xx and 5xx; 404s and errors as `{ error }`) and `@xeplr/utils` (`totp` for authenticator codes, `RateLimiter` as the wrong-try lockout, kept in memory, not Redis).

The page itself is [`@xeplr/ui-monitor`](https://github.com/Xeplr/xeplr-ui-monitor), built into `public/` and served by this package.

## How it works

On the servers, every app already runs as a systemd service: `xeplr-bi-api`, `xeplr-bi-auth`, `xeplr-bi-jobs`, and testbi's `xeplr-bi-dev-*`. The monitor starts nothing itself. It asks `systemctl` the same way the deploy does, and reads the journal, where the services' output goes.

```
browser ──https──▶ nginx ──▶ xeplr-monitor (port 19400, its own user)
                                 ├─ systemctl show            status (no sudo)
                                 ├─ sudo -n systemctl start|stop|restart|kill   (sudoers: xeplr-* only)
                                 └─ journalctl -u … -o json [-f]                 (systemd-journal group)
```

- A service is controlled only once someone has **added it** to the monitor's list, and only if its name matches **`MONITOR_ALLOW`** (e.g. `xeplr-*`). sudoers allows the same names and nothing else.
- Names are checked (`[A-Za-z0-9@._:-]`) before they reach a command. No shell is ever used: every command gets its arguments as a list.
- **Stop and kill refuse the monitor's own service**, which it finds from its cgroup. Stopping it would leave nothing to start it again. Restart is allowed.
- A live log is one `journalctl -f` process per open log. It ends when the page closes the log. Each user can have at most 10 open.
- Every command has a time limit: 2 minutes for an action (a stop waits for the service's own stop timeout), 30 seconds for a read.

## How healthy a service is

All from systemd and `/proc`, read without sudo, every time the list is asked for (the page asks every 5 seconds):

| | From |
|---|---|
| State, since when, why it last ended, exit code, restarts by itself | `systemctl show`: `ActiveState`, `SubState`, `Result`, `ExecMainStatus`, `NRestarts` |
| **What runs it**: the command line, working folder, user, unit file | `ExecStart`, `WorkingDirectory`, `User`, `FragmentPath`. The same command `ps` shows; the environment file's contents are never read |
| **Memory** now, its peak, its limit (`MemoryMax`, `MemoryHigh`), swap | `MemoryCurrent`, `MemoryPeak` (systemd 255+), `MemorySwapCurrent` |
| **CPU %** since the last reading, and CPU seconds in all | `CPUUsageNSec`, two readings apart. Above 100% means more than one core |
| Threads, against `TasksMax` | `TasksCurrent` |
| **Every process** of it: pid, parent, command, memory (RSS), swap, CPU %, threads, state, running since | the unit's cgroup (`cgroup.procs`, child cgroups too), then `/proc/<pid>/stat`, `status`, `cmdline`. At most 200, the main one first, then by memory |

The page turns these into a short **needs a look** list for a running service: memory at 90% of its limit or past `MemoryHigh`, restarts, swap in use, threads near their cap, CPU at 90% or more, processes stuck waiting on disk or network (`D`) or left as zombies (`Z`).

## Settings

| Variable | Required | What |
|---|---|---|
| `MONITOR_DATA_DIR` | **yes** | The folder for `users.json`, `services.json` and `audit.ndjson`. **Must be absolute**: a relative path would read a different user list depending on where the process was started. Created with mode 700 if missing. |
| `MONITOR_SECRET` | **yes** | Signs the sign-in cookie. At least 32 characters (`openssl rand -base64 48`). Changing it signs everyone out. |
| `MONITOR_ALLOW` | **yes** | Which services may be added and controlled, comma-separated; `*` matches anything: `xeplr-*` or `xeplr-*,postgresql`. Keep sudoers the same. |
| `MONITOR_PORT` | no | Default 19400. |
| `MONITOR_SUDO` | no | `actions` (default): start, stop, restart and kill go through `sudo -n`. `all`: reading the journal does too. `none`: nothing does (root, or polkit rights). |

There are no defaults for where data lives. A missing required setting stops the server at startup and names it. `requiredEnv` is exported, so a host can add it to its own `env.required.js`.

## Deploy to a server, from your laptop

```bash
npx -p @xeplr/monitor xeplr-monitor-deploy
```

It asks for what it needs, as it goes, and stores nothing: not in this (public) repository, not on your laptop.

- **The server:** host (or a name from `~/.ssh/config`), SSH login, port, private key file (blank uses ssh-agent or `~/.ssh/config`). The same SSH access BI's deploy uses; the login needs **passwordless sudo**.
- **The monitor:** the services it may control (`MONITOR_ALLOW`, default `xeplr-*`), its port (19400), and optionally its own web address for nginx, with an https certificate from certbot.
- **You:** email, name, and a password, typed hidden, twice. Blank keeps the password of a user who already exists.

Then it shows what it will do, asks to confirm, and runs `deploy/install.sh` on the server as root, sent on SSH's input, so no value is ever a file or a command-line argument there. The install:

1. makes the `xeplr-monitor` user (in `systemd-journal`) and `/var/lib/xeplr-monitor` (700);
2. installs `@xeplr/monitor` of the same version as the command (`--version` to choose);
3. writes `/etc/xeplr-monitor/monitor.env` (640). **`MONITOR_SECRET` is made on the server the first time and kept on every later deploy**, so a re-deploy signs nobody out;
4. writes `/etc/sudoers.d/xeplr-monitor` from `MONITOR_ALLOW`, checked with `visudo` first;
5. checks the monitor's user can ask systemd (D-Bus), writes the systemd unit with node's full path, enables it;
6. adds you, printing the authenticator secret to add to your phone, or changes your password;
7. restarts it and checks it answers on its port; with a web address, writes the nginx site, checks it with `nginx -t`, reloads, and runs certbot when asked.

Run it again to update: same questions, Enter keeps the values in brackets. Everything can also be given as arguments, so a re-deploy is one line; only the password is never an argument (it would sit in the shell history and in `ps`; `MONITOR_NEW_PASSWORD` is read for a script):

```bash
npx -p @xeplr/monitor xeplr-monitor-deploy --host testbi.xeplr.com --user ubuntu --key ~/.ssh/testbi.pem \
  --allow 'xeplr-*' --domain monitor.xeplr.com --certbot y --email you@xeplr.com --name "Your name"
npx -p @xeplr/monitor xeplr-monitor-deploy --help
```

It stops, saying why, when: SSH sign-in fails, the login has no passwordless sudo, Node.js 20+ or npm is missing, `systemd` or D-Bus is not there, the sudoers lines are invalid, a new user has no password, the monitor does not answer after starting (its last log lines are shown), or nginx refuses the site.

Keep the monitor's port closed in the firewall: nginx is the way in.

## Install on a server by hand

What the deploy does, step by step:

```bash
# 1. its own user, its folder, the package
sudo useradd -r -m -d /var/lib/xeplr-monitor -s /usr/sbin/nologin xeplr-monitor
sudo npm install -g @xeplr/monitor            # puts xeplr-monitor-server and xeplr-monitor-users on PATH
D=$(npm root -g)/@xeplr/monitor/deploy

# 2. settings
sudo mkdir -p /etc/xeplr-monitor
sudo cp $D/monitor.env.example /etc/xeplr-monitor/monitor.env
sudo editor /etc/xeplr-monitor/monitor.env      # set MONITOR_SECRET; check MONITOR_ALLOW
sudo chgrp xeplr-monitor /etc/xeplr-monitor/monitor.env && sudo chmod 640 /etc/xeplr-monitor/monitor.env

# 3. what it may do: sudoers for the actions; it reads logs as a member of systemd-journal
sudo install -m 440 $D/sudoers.example /etc/sudoers.d/xeplr-monitor && sudo visudo -c

# 4. the first user (asks for a password, then prints the authenticator secret)
sudo -u xeplr-monitor env MONITOR_DATA_DIR=/var/lib/xeplr-monitor xeplr-monitor-users add you@xeplr.com --name "Your name"

# 5. run it, and put nginx in front
sudo cp $D/xeplr-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now xeplr-monitor
# nginx: see deploy/nginx.conf.example (https, proxy_buffering off for live logs)
```

Then open the site, sign in, and add the services by their systemd names: `xeplr-bi-dev-api`, `xeplr-bi-dev-auth`, `xeplr-bi-dev-jobs`.

The server needs D-Bus (`systemctl` uses it as a non-root user). Every standard Ubuntu server has it.

## Users

Users are managed on the server only. The page cannot add a user, so a stolen session cannot add another.

```bash
xeplr-monitor-users list
xeplr-monitor-users add <email> [--name "…"] [--no-code]
xeplr-monitor-users password <email>          # signs that user out everywhere
xeplr-monitor-users code <email> [--off]      # a new authenticator secret, or none
xeplr-monitor-users remove <email>
```

Run them on the server as the monitor's user, with `MONITOR_DATA_DIR` set. `xeplr-monitor-deploy` runs `add` or `password` for you. A password is typed, never passed as an argument, because it would be left in the shell's history and in `ps`. `MONITOR_NEW_PASSWORD` is read instead when set, for a script.

- **Passwords:** scrypt hashes, at least 12 characters.
- **Codes:** a new user gets a six-digit code from an authenticator app by default (RFC 6238, 30 seconds; one step either side is accepted). `--no-code` turns that off.
- **Wrong tries:** 5 for one email within 15 minutes lock that email until the 15 minutes from its first wrong try are up. 20 from one address (any emails) lock the address the same way. A right password clears the email's count, not the address's. (`RateLimiter` from `@xeplr/utils`, in memory.) A wrong email and a wrong password get the same answer and take the same time, so the page doesn't reveal which emails exist.
- **Sessions:** a signed cookie (HMAC-SHA256 with `MONITOR_SECRET`) that lasts 12 hours. It is `HttpOnly`, `SameSite=Strict`, and `Secure` behind https. A changed password or code signs out that user's open sessions.
- **Request header:** every request that changes something must also carry `x-xeplr-monitor: 1`, which a form on another site cannot add.

## The audit log

`audit.ndjson` gets one line per sign-in, per change and per user change made on the server, with who, from which address, what, on which service, and whether it worked. Refused attempts are included. The page shows the newest 300 under **Audit log**.

## API

Mounted at `/api`. Everything except `/login` needs a signed-in user.

| Method | Path | |
|---|---|---|
| POST | `/login` | `{ email, password, code? }` → `{ user }` and the cookie. 401 `{ error, needsCode }` asks for the code; 429 means locked. |
| POST | `/logout` | |
| GET | `/me` | `{ user, allowed, self }`: who is signed in, what may be added, and the monitor's own service. |
| GET | `/services` | Every watched service with `status` (`state`, `subState`, `result`, `pid`, `restarts`, `since`, `exitStatus`, `memoryBytes`, `memoryPeakBytes`, `memoryMaxBytes`, `memoryHighBytes`, `swapBytes`, `cpuSeconds`, `cpuPercent`, `tasks`, `tasksMax`, `enabled`, `restartPolicy`, `runs: { commands: [{ path, command }], workingDirectory, user, unitFile }`) and `processes` (`pid`, `parent`, `name`, `command`, `state`, `memoryBytes`, `swapBytes`, `threads`, `cpuSeconds`, `cpuPercent`, `startedAt`). |
| POST | `/services` | `{ unit, label? }`. Refused if the name is not allowed (403) or systemd has no such service (404). |
| PATCH | `/services/:unit` | `{ label?, unit? }`, changed in place. |
| DELETE | `/services/:unit` | Stops watching it. The service itself is not touched. |
| POST | `/services/:unit/start` \| `stop` \| `restart` \| `kill` | → `{ unit, status }` afterwards. Kill sends SIGKILL to every process of it; systemd starts it again if it is set to restart. |
| GET | `/services/:unit/logs` | `?lines=` (max 5000) `&since=&until=` (ISO times) `&grep=` (any case) `&level=warn\|error` → `{ lines: [{ at, level, pid, from, message, cursor }] }`, oldest first. |
| GET | `/services/:unit/logs/live` | Server-sent events: one `data:` line per new log line, a heartbeat every 15 seconds. |
| GET | `/audit` | `?limit=` → `{ entries }`, newest first. |

Run the whole monitor with `start(config)`. A host built on `createApp` can mount the API itself instead: `init(config)`, then `auth: { middleware: monitor.gate }` and `routes: { '/api': monitor.router() }`. The router needs `createApp`'s body and cookie parsing.

## Development

```bash
npm test                     # users, sessions, codes, the API over HTTP; the systemd test on Linux
npm run build                # the page into public/ from @xeplr/ui-monitor
XEPLR_UI_MONITOR_SRC=../xeplr-ui-monitor/src/index.js npm run build   # from a local checkout of it
```

`test/systemd.test.js` controls a real service. It writes a small unit into `/run/systemd/system`, then adds, starts, follows, searches, restarts, kills, stops and edits it over HTTP. It needs Linux with systemd and passwordless sudo: GitHub's ubuntu runners have both, so CI runs it. Elsewhere it is skipped and says why. To run it on a Mac, use a systemd container:

```bash
docker run -d --name xm --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v "$PWD":/app --tmpfs /run --tmpfs /run/lock <an ubuntu image with systemd, sudo, dbus and node>
docker exec -w /app xm sh -c 'node --test test/*.test.js'
```

**systemd 255** (Ubuntu 24.04) kills the service and then reports that it could not signal its "auxiliary processes", even when it has none. The monitor treats a kill as done when the service really went down, and reports the error otherwise.
