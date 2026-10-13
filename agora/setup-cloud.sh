#!/bin/bash
#
# Agora: one-time setup on a Linux machine (Ubuntu or Debian), such as a
# Claude Code session in the cloud.
#
# Installs the tools Agora needs, creates its two databases, writes the
# settings files and fills Agora with made-up demo data. It is safe to run
# again: every step first checks whether it has been done already.
#
#   ./agora/setup-cloud.sh
#
# Afterwards, start Agora with ./agora/start.sh
#
# For a Mac, use ./agora/setup-mac.sh instead.
#
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="${AGORA_DB_NAME:-agora}"
TEST_DB_NAME="${AGORA_TEST_DB_NAME:-agora_test}"
PG_MAJOR="17"
NODE_VERSION="v24.21.0"
NODE_DIR="${AGORA_NODE_DIR:-$HOME/.local/share/agora-node24}"
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if [[ "$(uname)" != "Linux" ]] || ! command -v apt-get >/dev/null; then
  echo "This script is written for Ubuntu or Debian. On a Mac, use ./agora/setup-mac.sh"
  exit 1
fi
SUDO=""
[[ "$(id -u)" != "0" ]] && SUDO="sudo"
export DEBIAN_FRONTEND=noninteractive

step "1/7  Installing PostgreSQL $PG_MAJOR with PostGIS, and Redis"
# Hylo's schema.sql was made on PostgreSQL 17. Most Ubuntu versions ship an
# older one, so it comes from PostgreSQL's own package site.
if ! dpkg -s "postgresql-$PG_MAJOR-postgis-3" >/dev/null 2>&1; then
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
  if [[ ! -f /etc/apt/sources.list.d/pgdg.list ]]; then
    $SUDO install -d /usr/share/postgresql-common/pgdg
    $SUDO curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
      | $SUDO tee /etc/apt/sources.list.d/pgdg.list >/dev/null
    $SUDO apt-get update -qq
  fi
  $SUDO apt-get install -y -qq "postgresql-$PG_MAJOR" "postgresql-$PG_MAJOR-postgis-3" >/dev/null
fi
command -v redis-server >/dev/null || $SUDO apt-get install -y -qq redis-server >/dev/null

step "2/7  Installing Node 24"
if [[ "$(node -v 2>/dev/null | cut -d. -f1)" != "v24" ]]; then
  if [[ ! -x "$NODE_DIR/bin/node" ]]; then
    arch="$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')"
    file="node-$NODE_VERSION-linux-$arch.tar.gz"
    tmp="$(mktemp -d)"
    curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/$NODE_VERSION/$file"
    curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
    (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet)
    tar -xzf "$tmp/$file" -C "$tmp"
    mkdir -p "$(dirname "$NODE_DIR")"
    rm -rf "$NODE_DIR"
    mv "$tmp/${file%.tar.gz}" "$NODE_DIR"
    rm -rf "$tmp"
  fi
  export PATH="$NODE_DIR/bin:$PATH"
fi
echo "  Node $(node -v)"

step "3/7  Starting the database and Redis"
if ! pg_isready -q; then
  $SUDO pg_ctlcluster "$PG_MAJOR" main start 2>/dev/null || $SUDO service postgresql start
  for _ in $(seq 1 15); do pg_isready -q && break; sleep 1; done
fi
pg_isready -q || { echo "PostgreSQL did not start."; exit 1; }
# A database user with the same name as this machine's user, like on the Mac.
me="$(id -un)"
if ! $SUDO -u postgres psql -tAc "select 1 from pg_roles where rolname='$me'" | grep -q 1; then
  $SUDO -u postgres createuser --superuser "$me"
fi
# Local connections without a password, as on the Mac. Only this machine can connect.
hba="$($SUDO -u postgres psql -tAc 'show hba_file')"
if ! $SUDO grep -q '^# Agora' "$hba"; then
  printf '# Agora: local connections without a password\nlocal all all trust\nhost all all 127.0.0.1/32 trust\nhost all all ::1/128 trust\n' \
    | $SUDO tee "$hba.agora" >/dev/null
  $SUDO sh -c "cat '$hba' >> '$hba.agora' && mv '$hba.agora' '$hba'"
  $SUDO -u postgres psql -qc 'select pg_reload_conf()' >/dev/null
fi
if ! redis-cli ping >/dev/null 2>&1; then
  redis-server --daemonize yes --bind 127.0.0.1 --port 6379
  for _ in $(seq 1 10); do redis-cli ping >/dev/null 2>&1 && break; sleep 1; done
fi
redis-cli ping >/dev/null || { echo "Redis did not start."; exit 1; }

step "4/7  Installing Agora's own building blocks (this is the slow part)"
corepack enable 2>/dev/null || $SUDO env "PATH=$PATH" corepack enable
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
yarn install
yarn build-packages

step "5/7  Writing the settings files"
node agora/make-env.mjs "$DB_NAME"

step "6/7  Creating the databases"
make_db () {
  if psql -d postgres -lqt | cut -d '|' -f 1 | grep -qw "$1"; then
    echo "  The database \"$1\" already exists, leaving it as it is."
    return
  fi
  createdb "$1"
  psql -q -v ON_ERROR_STOP=1 "$1" < apps/backend/migrations/schema.sql >/dev/null
  # Tell the migration tool that everything in schema.sql is already in place.
  (cd apps/backend && DATABASE_URL="postgres://$me@localhost:5432/$1" yarn knex seed:run --specific=migrations.js >/dev/null)
  echo "  Created \"$1\"."
}
make_db "$DB_NAME"
make_db "$TEST_DB_NAME"
(cd apps/backend && yarn migrate >/dev/null)
(cd apps/backend && DATABASE_URL="postgres://$me@localhost:5432/$TEST_DB_NAME" yarn migrate >/dev/null)

step "7/7  Adding the made-up demo data"
(cd apps/backend && node scripts/agora-demo.js 2>&1 | tail -3)

cat <<DONE

Done. Start Agora with ./agora/start.sh and open http://localhost:3000
Log in as steward@agora.test. The password is in apps/backend/.agora-demo-login
Backend tests: cd apps/backend && DATABASE_URL=postgres://$me@localhost:5432/$TEST_DB_NAME yarn test
DONE
