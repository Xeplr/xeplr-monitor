#!/bin/bash
# XEPLR-MONITOR'S ONE PRIVILEGED COMMAND — installed by the deploy as
# /usr/local/libexec/xeplr-monitor-control (root-owned, 755), the only thing
# sudoers lets the monitor's user run as root:
#
#   xeplr-monitor ALL=(root) NOPASSWD: /usr/local/libexec/xeplr-monitor-control
#
#   xeplr-monitor-control start|stop|restart|kill <unit>
#
# It checks everything itself, so sudoers needs no wildcard: newer sudo
# (sudo-rs, Ubuntu's default) refuses `systemctl start xeplr-*`, and in the
# classic sudo that `*` also matched spaces. Exactly two arguments; one action
# of four; one unit name of plain characters, matching MONITOR_ALLOW; then
# systemctl, by its full path, with `--` before the name. The deploy puts both
# values in below.
set -euo pipefail

ALLOW='__MONITOR_ALLOW__'
SYSTEMCTL='__SYSTEMCTL__'

[ $# -eq 2 ] || { echo "usage: xeplr-monitor-control start|stop|restart|kill <unit>" >&2; exit 64; }
action=$1
unit=$2
case "$action" in start|stop|restart|kill) ;; *) echo "not an action: $action" >&2; exit 64 ;; esac
[[ "$unit" =~ ^[A-Za-z0-9][A-Za-z0-9@._:-]{0,200}$ ]] || { echo "not a service name: $unit" >&2; exit 64; }

allowed=0
IFS=',' read -ra patterns <<< "$ALLOW"
for p in "${patterns[@]}"; do
  p=${p//[[:space:]]/}
  [ -n "$p" ] || continue
  # $p unquoted on the right: a pattern, * matching anything — the whole name,
  # with or without its .service.
  if [[ "$unit" == $p || "${unit%.service}" == $p ]]; then allowed=1; fi
done
[ "$allowed" = 1 ] || { echo "$unit is not allowed (MONITOR_ALLOW=$ALLOW)" >&2; exit 77; }

if [ "$action" = kill ]; then exec "$SYSTEMCTL" kill --signal=SIGKILL -- "$unit"; fi
exec "$SYSTEMCTL" "$action" -- "$unit"
