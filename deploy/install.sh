# THE MONITOR, INSTALLED OR UPDATED ON A SERVER — run as root, by
# `xeplr-monitor-deploy` over SSH (bin/deploy.js puts the XM_* values above
# this file and sends both on SSH's input, so nothing is a file or an argument
# on the server). Safe to run again: it updates in place and keeps the sign-in
# secret, so nobody is signed out by a re-deploy.
#
#   XM_VERSION   the @xeplr/monitor version to install
#   XM_ALLOW     the services it may control (MONITOR_ALLOW), comma-separated
#   XM_PORT      its port; nginx forwards to it
#   XM_EMAIL     the user to add, or whose password to change
#   XM_NAME      that user's name (optional)
#   XM_PASSWORD  their new password; empty keeps an existing user's
#   XM_DOMAIN    its own web address for nginx; empty leaves nginx alone
#   XM_CERTBOT   1 to get an https certificate for XM_DOMAIN with certbot
set -euo pipefail

say() { printf '  %s\n' "$*"; }
stop() { printf '\n  Stopped: %s\n' "$*" >&2; exit 1; }

DATA=/var/lib/xeplr-monitor
ETC=/etc/xeplr-monitor
ENV_FILE=$ETC/monitor.env
USER_NAME=xeplr-monitor

# ── what the server must already have ────────────────────────────────────
command -v systemctl >/dev/null || stop "systemd is not here: the monitor controls systemd services"
NODE=$(command -v node || true)
[ -n "$NODE" ] || stop "Node.js is not installed (20 or newer is needed)"
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 20 ] || stop "Node.js $("$NODE" -v) is too old: 20 or newer is needed"
command -v npm >/dev/null || stop "npm is not installed"
SYSTEMCTL=$(command -v systemctl)

# ── its own user, which reads the journal ────────────────────────────────
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd -r -m -d "$DATA" -s /usr/sbin/nologin "$USER_NAME"
  say "User $USER_NAME made"
fi
usermod -aG systemd-journal "$USER_NAME"
mkdir -p "$DATA" && chown "$USER_NAME:$USER_NAME" "$DATA" && chmod 700 "$DATA"

# ── the package ──────────────────────────────────────────────────────────
say "Installing @xeplr/monitor@$XM_VERSION"
npm install -g --no-fund --no-audit --no-update-notifier --loglevel=error "@xeplr/monitor@$XM_VERSION" >/dev/null
ROOT="$(npm root -g)/@xeplr/monitor"
[ -f "$ROOT/bin/server.js" ] || stop "the package did not install into $ROOT"

# ── settings: the secret is made once and kept ───────────────────────────
mkdir -p "$ETC"
touch "$ENV_FILE"
if ! grep -q '^MONITOR_SECRET=.\{32,\}' "$ENV_FILE"; then
  sed -i '/^MONITOR_SECRET=/d' "$ENV_FILE"
  echo "MONITOR_SECRET=$("$NODE" -e 'process.stdout.write(require("crypto").randomBytes(48).toString("base64"))')" >> "$ENV_FILE"
  say "Sign-in secret made (kept on later deploys)"
fi
setting() { sed -i "/^$1=/d" "$ENV_FILE"; echo "$1=$2" >> "$ENV_FILE"; }
setting MONITOR_DATA_DIR "$DATA"
setting MONITOR_ALLOW "$XM_ALLOW"
setting MONITOR_PORT "$XM_PORT"
chown root:"$USER_NAME" "$ENV_FILE" && chmod 640 "$ENV_FILE"

# ── sudoers: start, stop, restart and kill the allowed services, nothing else
SUDOERS_TMP=$(mktemp)
{
  echo "# Made by xeplr-monitor-deploy from MONITOR_ALLOW=$XM_ALLOW. Changed by the next deploy."
  IFS=',' read -ra PATTERNS <<< "$XM_ALLOW"
  for raw in "${PATTERNS[@]}"; do
    p=$(echo "$raw" | tr -d '[:space:]')
    [ -n "$p" ] || continue
    echo "$USER_NAME ALL=(root) NOPASSWD: $SYSTEMCTL start $p, $SYSTEMCTL stop $p, $SYSTEMCTL restart $p, $SYSTEMCTL kill --signal=SIGKILL $p"
  done
} > "$SUDOERS_TMP"
visudo -cqf "$SUDOERS_TMP" || { rm -f "$SUDOERS_TMP"; stop "the sudoers lines for MONITOR_ALLOW=$XM_ALLOW are not valid"; }
install -m 440 "$SUDOERS_TMP" /etc/sudoers.d/xeplr-monitor && rm -f "$SUDOERS_TMP"

# ── it must be able to ask systemd as its own user (needs D-Bus) ─────────
sudo -u "$USER_NAME" "$SYSTEMCTL" show -p Version >/dev/null 2>&1 \
  || stop "$USER_NAME cannot ask systemd (no D-Bus?). Install and start dbus, then deploy again"

# ── the systemd service: node and the server by their full paths ─────────
UNIT=/etc/systemd/system/xeplr-monitor.service
sed "s#^ExecStart=.*#ExecStart=$NODE $ROOT/bin/server.js#" "$ROOT/deploy/xeplr-monitor.service" > "$UNIT"
# Node under a home folder (nvm) must stay readable to the service.
case "$NODE" in /home/*|/root/*) sed -i 's/^ProtectHome=true/ProtectHome=read-only/' "$UNIT" ;; esac
systemctl daemon-reload
systemctl enable xeplr-monitor >/dev/null 2>&1

# ── the user ─────────────────────────────────────────────────────────────
users() { sudo -u "$USER_NAME" env MONITOR_DATA_DIR="$DATA" MONITOR_NEW_PASSWORD="$XM_PASSWORD" "$NODE" "$ROOT/bin/users.js" "$@"; }
if users list | awk '{print tolower($1)}' | grep -qxF "$(printf '%s' "$XM_EMAIL" | tr '[:upper:]' '[:lower:]')"; then
  if [ -n "$XM_PASSWORD" ]; then users password "$XM_EMAIL" >/dev/null; say "Password changed for $XM_EMAIL (signed out everywhere)"
  else say "$XM_EMAIL is already a user: password kept"; fi
else
  [ -n "$XM_PASSWORD" ] || stop "$XM_EMAIL is not a user yet: a password is needed"
  if [ -n "$XM_NAME" ]; then users add "$XM_EMAIL" --name "$XM_NAME"; else users add "$XM_EMAIL"; fi
fi

# ── start it, and check it answers ───────────────────────────────────────
systemctl restart xeplr-monitor
answer=""
for _ in $(seq 1 20); do
  answer=$("$NODE" -e 'fetch("http://127.0.0.1:" + process.argv[1] + "/api/me").then(r => console.log(r.status)).catch(() => console.log(""))' "$XM_PORT")
  [ "$answer" = "401" ] && break
  sleep 0.5
done
[ "$answer" = "401" ] || { journalctl -u xeplr-monitor -n 20 --no-pager >&2; stop "the monitor did not answer on port $XM_PORT (its log is above)"; }
say "Running on port $XM_PORT"

# ── nginx, when asked ────────────────────────────────────────────────────
if [ -n "$XM_DOMAIN" ]; then
  command -v nginx >/dev/null || stop "nginx is not installed, so $XM_DOMAIN was not set up (the monitor itself is running)"
  if [ -d /etc/nginx/sites-available ]; then SITE=/etc/nginx/sites-available/xeplr-monitor; LINK=/etc/nginx/sites-enabled/xeplr-monitor
  else SITE=/etc/nginx/conf.d/xeplr-monitor.conf; LINK=""; fi
  # certbot adds the https part to this file; a re-deploy writes it afresh and runs certbot again.
  cat > "$SITE" <<NGINX
# Made by xeplr-monitor-deploy. Changed by the next deploy.
server {
  listen 80;
  server_name $XM_DOMAIN;
  location / {
    proxy_pass http://127.0.0.1:$XM_PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    # A live log is one long answer: no buffering, and kept open.
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
NGINX
  [ -z "$LINK" ] || ln -sf "$SITE" "$LINK"
  nginx -t -q || stop "nginx refused the new site ($SITE)"
  systemctl reload nginx
  say "nginx: $XM_DOMAIN → port $XM_PORT"
  if [ "$XM_CERTBOT" = "1" ]; then
    command -v certbot >/dev/null || stop "certbot is not installed, so $XM_DOMAIN has no https yet"
    certbot --nginx -d "$XM_DOMAIN" --non-interactive --agree-tos --redirect -m "$XM_EMAIL" >/dev/null
    say "https: certificate for $XM_DOMAIN"
  fi
fi
say "Done"
