#!/bin/bash
#
# Agora: keep the server on the newest merged version, by itself.
#
# agora-auto-update.timer runs this every 10 minutes. When GitHub's branch
# "agora" has a version that does not run here yet, it runs update.sh (backup,
# install, build, database, restart). Nothing new: it does nothing.
#
# A version whose update failed is not tried again every 10 minutes: the next
# merge, or update.sh by hand, tries again. See what happened with
#   sudo journalctl -u agora-auto-update -n 100
#
set -euo pipefail
APP_DIR=/srv/agora
STATE_DIR=/var/lib/agora
as_agora() { sudo -u agora -H "$@"; }
[[ "$(id -u)" == "0" ]] || { echo "Run this with sudo."; exit 1; }
cd /
mkdir -p "$STATE_DIR"

# An update started by hand is running: leave it alone.
if ! flock -n "$STATE_DIR/update.lock" true; then
  echo "An update is already running."
  exit 0
fi

as_agora git -C "$APP_DIR" fetch --quiet origin
branch="$(as_agora git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
newest="$(as_agora git -C "$APP_DIR" rev-parse "origin/$branch")"

# First run on a server that update.sh brought up to date before this existed.
if [[ ! -f "$STATE_DIR/deployed" ]]; then
  as_agora git -C "$APP_DIR" rev-parse HEAD > "$STATE_DIR/deployed"
  echo "Started keeping track: Agora runs $(cut -c1-9 "$STATE_DIR/deployed")."
fi

[[ "$newest" == "$(cat "$STATE_DIR/deployed")" ]] && exit 0
if [[ "$newest" == "$(cat "$STATE_DIR/failed" 2>/dev/null)" ]]; then
  echo "The update to ${newest:0:9} failed before; waiting for a newer version or an update by hand."
  exit 0
fi

echo "New version on GitHub: ${newest:0:9}. Updating."
# --force: after a failed update the code may already be pulled, only not built.
if ! bash "$APP_DIR/agora/vps/update.sh" --force; then
  echo "$newest" > "$STATE_DIR/failed"
  echo "The update to ${newest:0:9} failed. Agora keeps running the version it had."
  exit 1
fi
