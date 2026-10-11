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
source agora/tools.sh

agora_start_services

trap 'kill 0' EXIT INT TERM

echo "Starting the server and the web app. The first start takes a minute or two."
echo "When you see \"You can now view web in the browser\", open http://localhost:3000"
echo "The first time, the page stays empty for up to a minute while the web app gets ready."
echo

yarn workspace backend dev &
yarn workspace web dev &
wait
