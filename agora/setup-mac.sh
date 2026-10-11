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
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="${AGORA_DB_NAME:-agora}"
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script is written for macOS. On other systems, follow the steps in README-AGORA.md by hand."
  exit 1
fi
if ! command -v brew >/dev/null; then
  echo "Homebrew is needed first. Install it from https://brew.sh and run this script again."
  exit 1
fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Apple's command line tools are needed first. Run this, wait for it to finish, then run this script again:"
  echo "  xcode-select --install"
  exit 1
fi

step "1/7  Installing the tools (Node, PostgreSQL with PostGIS, Redis, GraphicsMagick)"
for formula in node@24 postgis redis graphicsmagick; do
  brew list --formula "$formula" >/dev/null 2>&1 || brew install "$formula"
done
export PATH="$(brew --prefix node@24)/bin:$PATH"

# PostGIS is built for one particular PostgreSQL version. Use that one.
PG_FORMULA="$(brew deps --formula postgis | grep -E '^postgresql@[0-9]+$' | sort -t@ -k2 -n | tail -1)"
if [[ -z "$PG_FORMULA" ]]; then
  echo "Could not work out which PostgreSQL version PostGIS uses. Run 'brew deps postgis' and ask for help."
  exit 1
fi
export PATH="$(brew --prefix "$PG_FORMULA")/bin:$PATH"

step "2/7  Starting the database ($PG_FORMULA) and Redis"
brew services start "$PG_FORMULA" >/dev/null
brew services start redis >/dev/null
for _ in $(seq 1 30); do pg_isready -q && break; sleep 1; done
pg_isready -q || { echo "PostgreSQL did not start. Try: brew services restart $PG_FORMULA"; exit 1; }

step "3/7  Installing Agora's own building blocks (this is the slow part)"
# corepack hands out the exact yarn version this project asks for
command -v corepack >/dev/null || npm install -g corepack
corepack enable
yarn install
yarn build-packages

step "4/7  Writing the settings files"
node agora/make-env.mjs "$DB_NAME"

step "5/7  Creating the database"
if psql -lqt | cut -d '|' -f 1 | grep -qw "$DB_NAME"; then
  echo "  The database \"$DB_NAME\" already exists, leaving it as it is."
else
  createdb "$DB_NAME"
  psql -q "$DB_NAME" < apps/backend/migrations/schema.sql >/dev/null
  # Tell the migration tool that everything in schema.sql is already in place.
  (cd apps/backend && yarn knex seed:run --specific=migrations.js >/dev/null)
  echo "  Created \"$DB_NAME\"."
fi
(cd apps/backend && yarn migrate >/dev/null)

step "6/7  Adding the made-up demo data"
(cd apps/backend && node scripts/agora-demo.js 2>&1 | tail -5)

step "7/7  Done"
cat <<'DONE'
Start Agora with:

  ./agora/start.sh

Then open http://localhost:3000 and log in as steward@agora.test.
The password is in the file apps/backend/.agora-demo-login
DONE
