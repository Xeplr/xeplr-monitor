#!/bin/bash
# XEPLR-MONITOR'S ONE PRIVILEGED COMMAND — installed by the deploy as
# /usr/local/libexec/xeplr-monitor-control (root-owned, 755), the only thing
# sudoers lets the monitor's user run as root:
#
#   xeplr-monitor ALL=(root) NOPASSWD: /usr/local/libexec/xeplr-monitor-control
#
#   xeplr-monitor-control start|stop|restart|kill <unit>
#
# It checks its arguments itself, so sudoers needs no wildcard (newer sudo,
# sudo-rs, refuses one in arguments; classic sudo's `*` also matched spaces).
# Exactly two arguments; one action of four; one unit name of plain characters;
# then systemctl, by its full path (the deploy puts it in below), with `--`
# before the name. Which services a person may control is decided by their
# roles in the app, not here.
set -euo pipefail

SYSTEMCTL='__SYSTEMCTL__'

[ $# -eq 2 ] || { echo "usage: xeplr-monitor-control start|stop|restart|kill <unit>" >&2; exit 64; }
action=$1
unit=$2
case "$action" in start|stop|restart|kill) ;; *) echo "not an action: $action" >&2; exit 64 ;; esac
[[ "$unit" =~ ^[A-Za-z0-9][A-Za-z0-9@._:-]{0,200}$ ]] || { echo "not a service name: $unit" >&2; exit 64; }

if [ "$action" = kill ]; then exec "$SYSTEMCTL" kill --signal=SIGKILL -- "$unit"; fi
exec "$SYSTEMCTL" "$action" -- "$unit"
