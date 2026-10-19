#!/bin/bash
#
# Agora: bring a new version onto the server.
#
#   sudo /srv/agora/agora/vps/update.sh
#
# Takes the newest code of the branch "agora" from GitHub, makes a backup of
# the database first, installs, builds, updates the database and restarts.
# It only moves forward to what is on GitHub; local changes on the server stop it.
#
set -euo pipefail
APP_DIR=/srv/agora
NODE_DIR=/opt/agora-node24
as_agora() { sudo -u agora -H env "PATH=$NODE_DIR/bin:/usr/bin:/bin" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"; }
[[ "$(id -u)" == "0" ]] || { echo "Run this with sudo."; exit 1; }

echo "Fetching the new version"
as_agora git -C "$APP_DIR" fetch --quiet origin
before="$(as_agora git -C "$APP_DIR" rev-parse --short HEAD)"
as_agora git -C "$APP_DIR" merge --ff-only --quiet "origin/$(as_agora git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
after="$(as_agora git -C "$APP_DIR" rev-parse --short HEAD)"
if [[ "$before" == "$after" && "${1:-}" != "--force" ]]; then
  echo "Already up to date ($after). Use --force to rebuild anyway."
  exit 0
fi
echo "  $before -> $after"

# rclone and /etc/agora for the off-server backup copy. Installs only what is missing.
bash "$APP_DIR/agora/vps/offsite-backup.sh" prepare || echo "  The off-server copy could not be prepared (see above). The update goes on."

echo "Backing up the database"
# Only on this server: the nightly backup sends its copy away, this one need not wait for that.
as_agora AGORA_OFFSITE=off bash "$APP_DIR/agora/vps/backup.sh"

echo "Installing and building (10 to 30 minutes)"
as_agora bash -c "cd '$APP_DIR' && export ELECTRON_SKIP_BINARY_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1 && (yarn install || yarn install) && yarn build-packages"
as_agora bash -c "cd '$APP_DIR/apps/web' && NODE_OPTIONS=--max-old-space-size=3072 node scripts/build.js >/dev/null && touch dist/.agora-built"

echo "Search by meaning for Ask (pgvector), once"
PG_MAJOR="$(sudo -u postgres psql -tAc 'show server_version_num' | cut -c1-2)"
if ! dpkg -s "postgresql-$PG_MAJOR-pgvector" >/dev/null 2>&1; then
  (apt-get install -y -qq "postgresql-$PG_MAJOR-pgvector" >/dev/null 2>&1 \
    || (apt-get update -qq && apt-get install -y -qq "postgresql-$PG_MAJOR-pgvector" >/dev/null 2>&1)) \
    || echo "  pgvector could not be installed. Ask still works, by keywords only."
fi
sudo -u postgres psql -q -d agora -c 'create extension if not exists vector with schema public' >/dev/null 2>&1 \
  || echo "  pgvector is not switched on. Ask still works, by keywords only."

echo "Updating the database"
as_agora bash -c "cd '$APP_DIR/apps/backend' && yarn migrate >/dev/null"
# Only adds what is missing: what stewards may do, also for circles made before
as_agora bash -c "cd '$APP_DIR/apps/backend' && node scripts/agora-steward-roles.js"

echo "Restarting"
systemctl restart agora-api agora-worker agora-web
echo "Done: Agora now runs $after."
