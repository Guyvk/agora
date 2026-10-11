#!/bin/bash
#
# Agora: start everything on your own computer.
#
#   ./agora/start.sh
#
# Runs the server (port 3001), its background worker and the web app
# (port 3000). Press Ctrl-C to stop all of them.
#
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v brew >/dev/null; then
  brew list --formula node@24 >/dev/null 2>&1 && export PATH="$(brew --prefix node@24)/bin:$PATH"
  PG_FORMULA="$(brew deps --formula postgis 2>/dev/null | grep -E '^postgresql@[0-9]+$' | sort -t@ -k2 -n | tail -1 || true)"
  [[ -n "${PG_FORMULA:-}" ]] && brew services start "$PG_FORMULA" >/dev/null 2>&1 || true
  brew services start redis >/dev/null 2>&1 || true
fi

trap 'kill 0' EXIT INT TERM

echo "Starting the server and the web app. The first start takes a minute or two."
echo "When you see \"You can now view web in the browser\", open http://localhost:3000"
echo

yarn workspace backend dev &
yarn workspace web dev &
wait
