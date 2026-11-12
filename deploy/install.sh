# XEPLR-MONITOR, INSTALLED OR UPDATED ON A SERVER — run as root by
# deploy/deploy.js over SSH: it puts the XM_* values above this file and sends
# both on SSH's input, so no value is ever a file or a command-line argument
# on the server. Safe to run again: it installs a new release beside the old
# one, keeps the settings (and so every secret and sign-in), and switches over.
#
#   XM_TARBALL     the app's source, already copied to the server (deploy --source)
#   XM_REF         or: the GitHub ref of Xeplr/xeplr-monitor to fetch (main, a tag)
#   XM_PORT_BASE   ui slot; the sign-in service is +1, the API +2 (19400 → 19401, 19402)
#   XM_ALLOW       MONITOR_ALLOW: the services it may control, comma-separated
#   XM_DB_HOST, XM_DB_PORT, XM_DB_USER, XM_DB_PASSWORD
#                  the Postgres it uses (a user that may create databases);
#                  all empty keeps the connection a previous deploy wrote
#   XM_REDIS_HOST, XM_REDIS_PORT, XM_REDIS_PASSWORD
#   XM_ADMIN_EMAIL, XM_ADMIN_PASSWORD
#                  the Super Admin; an empty password keeps the one written before
#   XM_DOMAIN      its web address for nginx; empty leaves nginx alone
#   XM_CERTBOT     1 to get an https certificate for XM_DOMAIN with certbot
set -euo pipefail

say() { printf '  %s\n' "$*"; }
export NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
stop() { printf '\n  Stopped: %s\n' "$*" >&2; exit 1; }

APP=/opt/xeplr-monitor
SHARED=$APP/shared
ENV_FILE=$SHARED/production.env
VAR=/var/lib/xeplr-monitor
USER_NAME=xeplr-monitor
AUTH_PORT=$((XM_PORT_BASE + 1))
API_PORT=$((XM_PORT_BASE + 2))

# ── what the server must already have ────────────────────────────────────
command -v systemctl >/dev/null || stop "systemd is not here: the monitor controls systemd services"
NODE=$(command -v node || true)
[ -n "$NODE" ] || stop "Node.js is not installed (20 or newer is needed)"
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 20 ] || stop "Node.js $("$NODE" -v) is too old: 20 or newer is needed"
command -v npm >/dev/null || stop "npm is not installed"
command -v tar >/dev/null || stop "tar is not installed"
SYSTEMCTL=$(command -v systemctl)

# ── its own user, which reads the journal ────────────────────────────────
id "$USER_NAME" >/dev/null 2>&1 || { useradd -r -m -d "$VAR" -s /usr/sbin/nologin "$USER_NAME"; say "User $USER_NAME made"; }
usermod -aG systemd-journal "$USER_NAME"
mkdir -p "$VAR/logs" "$SHARED" "$APP/releases"
chown -R "$USER_NAME:$USER_NAME" "$VAR" && chmod 750 "$VAR"

# ── this release: the source, its packages, the page built ───────────────
REL=$APP/releases/$(date -u +%Y%m%d%H%M%S)
mkdir -p "$REL"
if [ -n "${XM_TARBALL:-}" ]; then
  tar -xzf "$XM_TARBALL" -C "$REL" && rm -f "$XM_TARBALL"
  say "Source: the copy sent from your machine"
else
  command -v curl >/dev/null || stop "curl is not installed"
  curl -fsSL "https://codeload.github.com/Xeplr/xeplr-monitor/tar.gz/$XM_REF" | tar -xz -C "$REL" --strip-components=1 \
    || stop "could not fetch Xeplr/xeplr-monitor at \"$XM_REF\""
  say "Source: Xeplr/xeplr-monitor at $XM_REF"
fi
[ -f "$REL/api/bin/www" ] && [ -f "$REL/ui/package.json" ] || stop "that source is not xeplr-monitor (no api/bin/www or ui/)"
say "Installing packages (api, ui)"
(cd "$REL/api" && npm ci --no-fund --no-audit --no-update-notifier --loglevel=error >/dev/null)
(cd "$REL/ui" && npm ci --no-fund --no-audit --no-update-notifier --loglevel=error >/dev/null && npx vite build --logLevel error >/dev/null)
[ -f "$REL/ui/dist/index.html" ] || stop "the page did not build"
chown -R "$USER_NAME:$USER_NAME" "$REL"

# ── settings: written once, kept after; secrets made here, never asked ───
touch "$ENV_FILE"
# The answers go to this one process only, not to every command after it.
env XM_ENV_FILE="$ENV_FILE" XM_AUTH_PORT="$AUTH_PORT" XM_API_PORT="$API_PORT" XM_VAR="$VAR" \
  XM_ALLOW="$XM_ALLOW" XM_DOMAIN="$XM_DOMAIN" XM_CERTBOT="$XM_CERTBOT" \
  XM_DB_HOST="$XM_DB_HOST" XM_DB_PORT="$XM_DB_PORT" XM_DB_USER="$XM_DB_USER" XM_DB_PASSWORD="$XM_DB_PASSWORD" \
  XM_REDIS_HOST="$XM_REDIS_HOST" XM_REDIS_PORT="$XM_REDIS_PORT" XM_REDIS_PASSWORD="$XM_REDIS_PASSWORD" \
  XM_ADMIN_EMAIL="$XM_ADMIN_EMAIL" XM_ADMIN_PASSWORD="$XM_ADMIN_PASSWORD" \
  "$NODE" "$REL/deploy/settings.cjs" "$REL/api" || stop "the settings could not be written"
chown root:"$USER_NAME" "$ENV_FILE" && chmod 640 "$ENV_FILE"

# ── the databases, the sign-in tables and the permissions ────────────────
run_api() { (cd "$REL/api" && sudo -u "$USER_NAME" env NODE_ENV=production node_modules/.bin/dotenv -e "$ENV_FILE" -- "$@"); }
say "Databases: creating any that are missing, then the sign-in migrations"
run_api node_modules/.bin/xeplr-migrate create-db --connectionName auth --connection-env AUTH_DB_CONNECTION_INFO_ENCRYPTED --db-env AUTH_DB_NAME >/dev/null \
  || stop "could not reach or create the sign-in database (is Postgres running, and may that user create databases?)"
run_api node_modules/.bin/xeplr-migrate create-db --connectionName api --connection-env XEPLR_MONITOR_CONNECTION --db-env DB_API >/dev/null \
  || stop "could not create the app's database"
run_api node_modules/.bin/xeplr-auth-migrate up --connection-env AUTH_DB_CONNECTION_INFO_ENCRYPTED >/dev/null \
  || stop "the sign-in migrations failed"

# ── sudoers: start, stop, restart and kill the allowed services, nothing else
SUDOERS_TMP=$(mktemp)
{
  echo "# Made by xeplr-monitor's deploy from MONITOR_ALLOW=$XM_ALLOW. Changed by the next deploy."
  IFS=',' read -ra PATTERNS <<< "$XM_ALLOW"
  for raw in "${PATTERNS[@]}"; do
    p=$(echo "$raw" | tr -d '[:space:]')
    [ -n "$p" ] || continue
    echo "$USER_NAME ALL=(root) NOPASSWD: $SYSTEMCTL start $p, $SYSTEMCTL stop $p, $SYSTEMCTL restart $p, $SYSTEMCTL kill --signal=SIGKILL $p"
  done
} > "$SUDOERS_TMP"
visudo -cqf "$SUDOERS_TMP" || { rm -f "$SUDOERS_TMP"; stop "the sudoers lines for MONITOR_ALLOW=$XM_ALLOW are not valid"; }
install -m 440 "$SUDOERS_TMP" /etc/sudoers.d/xeplr-monitor && rm -f "$SUDOERS_TMP"
sudo -u "$USER_NAME" "$SYSTEMCTL" show -p Version >/dev/null 2>&1 \
  || stop "$USER_NAME cannot ask systemd (no D-Bus?). Install and start dbus, then deploy again"

# ── switch to this release, and the two services ─────────────────────────
ln -sfn "$REL" "$APP/current"
unit() {   # name, description, command (run in current/api), extra lines
  cat > "/etc/systemd/system/$1.service" <<UNIT
# Made by xeplr-monitor's deploy. Changed by the next deploy.
[Unit]
Description=$2
After=network-online.target postgresql.service redis-server.service

[Service]
Type=simple
User=$USER_NAME
Group=$USER_NAME
WorkingDirectory=$APP/current/api
EnvironmentFile=$ENV_FILE
ExecStart=$3
Restart=always
RestartSec=3
PrivateTmp=true
$4

[Install]
WantedBy=multi-user.target
UNIT
}
unit xeplr-monitor-auth "xeplr-monitor: sign-in (@xeplr/auth)" "$NODE $APP/current/api/node_modules/@xeplr/auth/bin/server.js" ""
# The API controls services: the journal group reads their logs; sudo needs
# to gain privileges, so NoNewPrivileges stays off — sudoers is the limit.
unit xeplr-monitor-api "xeplr-monitor: the API (services, logs, start/stop)" "$NODE $APP/current/api/bin/www" "SupplementaryGroups=systemd-journal"
systemctl daemon-reload
systemctl enable xeplr-monitor-auth xeplr-monitor-api >/dev/null 2>&1
systemctl restart xeplr-monitor-auth xeplr-monitor-api

# ── check both answer ─────────────────────────────────────────────────────
answers() { "$NODE" -e 'fetch(process.argv[1]).then(r => console.log(r.status)).catch(() => console.log(""))' "$1"; }
for name in auth api; do
  url="http://127.0.0.1:$AUTH_PORT/auth/api/login"; [ "$name" = api ] && url="http://127.0.0.1:$API_PORT/health"
  got=""
  for _ in $(seq 1 60); do got=$(answers "$url"); [ -n "$got" ] && [ "$got" != "502" ] && break; sleep 1; done
  [ -n "$got" ] || { journalctl -u "xeplr-monitor-$name" -n 25 --no-pager >&2; stop "xeplr-monitor-$name did not answer (its log is above)"; }
done
say "Running: sign-in on $AUTH_PORT, the API on $API_PORT"

# Old releases: the newest three are kept, to switch back to by hand.
ls -1dt "$APP"/releases/*/ | tail -n +4 | xargs -r rm -rf

# ── nginx, when asked ────────────────────────────────────────────────────
if [ -n "$XM_DOMAIN" ]; then
  command -v nginx >/dev/null || stop "nginx is not installed, so $XM_DOMAIN was not set up (the monitor itself is running)"
  if [ -d /etc/nginx/sites-available ]; then SITE=/etc/nginx/sites-available/xeplr-monitor; LINK=/etc/nginx/sites-enabled/xeplr-monitor
  else SITE=/etc/nginx/conf.d/xeplr-monitor.conf; LINK=""; fi
  # The page from ui/dist; /auth/api to the sign-in service; /api, /health and
  # /whoami to the API. certbot adds https to this file; a re-deploy writes it
  # afresh and runs certbot again.
  cat > "$SITE" <<NGINX
# Made by xeplr-monitor's deploy. Changed by the next deploy.
server {
  listen 80;
  server_name $XM_DOMAIN;
  root $APP/current/ui/dist;

  location /auth/api/ { proxy_pass http://127.0.0.1:$AUTH_PORT; proxy_set_header Host \$host; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; }
  location /api/ {
    proxy_pass http://127.0.0.1:$API_PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    # A live log is one long answer: no buffering, and kept open.
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
  location = /health { proxy_pass http://127.0.0.1:$API_PORT; }
  location = /whoami { proxy_pass http://127.0.0.1:$API_PORT; }
  location / { try_files \$uri /index.html; }
}
NGINX
  [ -z "$LINK" ] || ln -sf "$SITE" "$LINK"
  nginx -t -q || stop "nginx refused the new site ($SITE)"
  systemctl reload nginx
  say "nginx: $XM_DOMAIN"
  if [ "$XM_CERTBOT" = "1" ]; then
    command -v certbot >/dev/null || stop "certbot is not installed, so $XM_DOMAIN has no https yet"
    certbot --nginx -d "$XM_DOMAIN" --non-interactive --agree-tos --redirect -m "$XM_ADMIN_EMAIL" >/dev/null
    say "https: certificate for $XM_DOMAIN"
  fi
fi
say "Done"
