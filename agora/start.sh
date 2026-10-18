#!/bin/bash
#
# Agora: start everything on your own computer.
#
#   ./agora/start.sh          to use Agora: quick to open, no restarts
#   ./agora/start.sh dev      to change Agora's code: picks up changes as you save
#
# Runs the server (port 3001), its background worker and the web app
# (port 3000). Press Ctrl-C to stop all of them.
#
# The first mode uses a ready-built copy of the web app. It is built the first
# time and again whenever the web app's code or settings have changed since,
# which takes a few minutes. After that, Agora opens in seconds.
#
set -euo pipefail
cd "$(dirname "$0")/.."
source agora/tools.sh

MODE="${1:-use}"
agora_start_services

trap 'kill 0' EXIT INT TERM

# Hylo's regular jobs: every 10 minutes the search index is refreshed (finding
# members needs it) and quiet meetings are closed so their minutes get written.
# Every hour, chat digests go out. On a server, timers do this (agora/vps).
(
  ticks=0
  sleep 60
  while true; do
    (cd apps/backend && node --env-file=.env cron.js --interval every10minutes >/dev/null 2>&1) &
    (( ticks % 6 == 0 )) && (cd apps/backend && node --env-file=.env cron.js --interval hourly >/dev/null 2>&1) &
    ticks=$((ticks + 1))
    sleep 600
  done
) &

if [[ "$MODE" == "dev" ]]; then
  echo "Starting Agora for changing its code. The first start takes a minute or two."
  echo "When you see \"You can now view web in the browser\", open http://localhost:3000"
  echo "The first time, the page stays empty for up to a minute while the web app gets ready."
  echo

  # The server restarts itself when its code changes. Its file watcher keeps every
  # file open unless told to check now and then instead, and on a Mac that runs
  # out of open files and stops the background worker, which writes the minutes.
  CHOKIDAR_USEPOLLING=1 yarn workspace backend dev &
  yarn workspace web dev &
  wait
  exit
fi

# Build the web app when there is no ready-built copy, or when anything it is
# made from changed after the last build.
built=apps/web/dist/.agora-built
changed=""
if [[ -f "$built" ]]; then
  changed="$(find apps/web/src apps/web/public apps/web/index.html apps/web/.env apps/web/vite.config.js packages \
    -path '*/node_modules' -prune -o -type f -newer "$built" -print -quit)"
fi
if [[ ! -f "$built" || -n "$changed" ]]; then
  echo "Building the web app. This takes a few minutes and only happens after a change."
  (cd apps/web && node scripts/build.js >/dev/null)
  touch "$built"
fi

echo "Starting Agora. Open http://localhost:3000 in about half a minute."
echo

(cd apps/backend && PORT=3001 node app.js) &
(cd apps/backend && DELAY_START=5 node --env-file=.env worker.js) &
(cd apps/web && PORT=3000 node src/server/index.js) &
wait
