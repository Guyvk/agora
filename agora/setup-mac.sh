#!/bin/bash
#
# Agora: one-time setup on a Mac.
#
# Installs the tools Agora needs, creates its database, writes the settings
# files and fills Agora with made-up demo data. It is safe to run again: every
# step first checks whether it has been done already.
#
#   ./agora/setup-mac.sh
#
# Afterwards, start Agora with ./agora/start.sh
#
# The database comes from Postgres.app and Node from nodejs.org, both ready-made.
# Redis is built from its own source code. Homebrew is not used for these: on
# macOS versions it no longer supports, it builds everything from source, which
# for PostGIS alone meant more than 130 packages and most of a day.
#
set -euo pipefail
cd "$(dirname "$0")/.."
source agora/tools.sh

DB_NAME="${AGORA_DB_NAME:-agora}"
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script is written for macOS. On other systems, follow the steps in README-AGORA.md by hand."
  exit 1
fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Apple's command line tools are needed first. Run this, wait for it to finish, then run this script again:"
  echo "  xcode-select --install"
  exit 1
fi

step "1/7  Installing the tools (Node, Postgres.app with PostGIS, Redis)"
agora_install_node
agora_install_postgres
agora_install_redis
echo "  Node $(node -v), PostgreSQL $AGORA_PG_MAJOR, Redis $(redis-server --version | grep -oE 'v=[0-9.]+' | cut -c3-)"

step "2/7  Starting the database and Redis"
agora_start_services
pg_isready -q || { echo "PostgreSQL did not start. See: $AGORA_PG_DATA/postgresql.log"; exit 1; }
redis-cli -p "$AGORA_REDIS_PORT" ping >/dev/null || { echo "Redis did not start. See: $AGORA_REDIS_DIR/redis.log"; exit 1; }

step "3/7  Installing Agora's own building blocks (this is the slow part)"
# corepack comes with Node and hands out the exact yarn version this project asks for
corepack enable
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
yarn install
yarn build-packages

step "4/7  Writing the settings files"
node agora/make-env.mjs "$DB_NAME"

step "5/7  Creating the database"
if psql -d postgres -lqt | cut -d '|' -f 1 | grep -qw "$DB_NAME"; then
  echo "  The database \"$DB_NAME\" already exists, leaving it as it is."
else
  createdb "$DB_NAME"
  psql -q -v ON_ERROR_STOP=1 "$DB_NAME" < apps/backend/migrations/schema.sql >/dev/null
  # Tell the migration tool that everything in schema.sql is already in place.
  (cd apps/backend && yarn knex seed:run --specific=migrations.js >/dev/null)
  echo "  Created \"$DB_NAME\"."
fi
(cd apps/backend && yarn migrate >/dev/null)

step "6/7  Adding the made-up demo data"
(cd apps/backend && node scripts/agora-demo.js 2>&1 | tail -3)

step "7/7  Done"
# GraphicsMagick resizes uploaded pictures. Uploads are off for now, so it is
# not installed here. Before switching uploads on: brew install graphicsmagick
cat <<'DONE'
Start Agora with:

  ./agora/start.sh

Then open http://localhost:3000 and log in as steward@agora.test.
The password is in the file apps/backend/.agora-demo-login
The first time, the page can take a minute to appear.
DONE
