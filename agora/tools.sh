# Agora: where the tools live on a Mac. Used by setup-mac.sh and start.sh.
#
# Node and Redis go into a folder in your home directory, so no administrator
# password is needed. Each AGORA_* folder can be changed by setting it before
# running a script.

AGORA_NODE_VERSION="v24.21.0"
AGORA_NODE_DIR="${AGORA_NODE_DIR:-$HOME/.local/share/agora-node24}"

AGORA_REDIS_VERSION="8.10.2"
# From https://github.com/redis/redis-hashes
AGORA_REDIS_SHA256="b9ffee226b5eecdba98a679260dad764b2a4ebd90dce4ad5ac9e9f3eef9c02b3"
AGORA_REDIS_DIR="${AGORA_REDIS_DIR:-$HOME/.local/share/agora-redis}"
AGORA_REDIS_PORT="${AGORA_REDIS_PORT:-6379}"

# Hylo's schema.sql was made with Postgres.app on PostgreSQL 17.
AGORA_PGAPP_VERSION="2.9.6"
AGORA_PG_MAJOR="17"
AGORA_PG_BIN="/Applications/Postgres.app/Contents/Versions/$AGORA_PG_MAJOR/bin"
# The same folder Postgres.app itself uses, so the app shows this database too.
AGORA_PG_DATA="${AGORA_PG_DATA:-$HOME/Library/Application Support/Postgres/var-$AGORA_PG_MAJOR}"

export PATH="$AGORA_NODE_DIR/bin:$AGORA_REDIS_DIR/bin:$AGORA_PG_BIN:$PATH"

# Downloads Node from nodejs.org and checks it against the published checksum.
agora_install_node () {
  [[ -x "$AGORA_NODE_DIR/bin/node" ]] && return
  local arch file tmp
  arch="$(uname -m | sed 's/x86_64/x64/')"
  file="node-$AGORA_NODE_VERSION-darwin-$arch.tar.gz"
  tmp="$(mktemp -d)"
  echo "  Downloading Node $AGORA_NODE_VERSION from nodejs.org"
  curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/$AGORA_NODE_VERSION/$file"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$AGORA_NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | shasum -a 256 -c --quiet)
  tar -xzf "$tmp/$file" -C "$tmp"
  mkdir -p "$(dirname "$AGORA_NODE_DIR")"
  rm -rf "$AGORA_NODE_DIR"
  mv "$tmp/${file%.tar.gz}" "$AGORA_NODE_DIR"
  rm -rf "$tmp"
}

# Builds Redis from its official source code. Homebrew's Redis needs llvm and
# Rust on Macs it has no ready-made packages for, which takes hours. Redis
# itself is plain C and builds in a few minutes with Apple's own tools.
agora_install_redis () {
  [[ -x "$AGORA_REDIS_DIR/bin/redis-server" ]] && return
  local file="redis-$AGORA_REDIS_VERSION.tar.gz" tmp
  tmp="$(mktemp -d)"
  echo "  Downloading and building Redis $AGORA_REDIS_VERSION (a few minutes)"
  curl -fsSL -o "$tmp/$file" "https://download.redis.io/releases/$file"
  (cd "$tmp" && echo "$AGORA_REDIS_SHA256  $file" | shasum -a 256 -c --quiet)
  tar -xzf "$tmp/$file" -C "$tmp"
  # Only Redis itself, not its optional add-ons, which Agora does not use.
  make -C "$tmp/redis-$AGORA_REDIS_VERSION/src" -j"$(sysctl -n hw.ncpu)" redis-server redis-cli >"$tmp/build.log" 2>&1 \
    || { tail -20 "$tmp/build.log"; echo "Redis could not be built. The full log is in $tmp/build.log"; return 1; }
  mkdir -p "$AGORA_REDIS_DIR/bin" "$AGORA_REDIS_DIR/data"
  cp "$tmp/redis-$AGORA_REDIS_VERSION/src/redis-server" "$tmp/redis-$AGORA_REDIS_VERSION/src/redis-cli" "$AGORA_REDIS_DIR/bin/"
  rm -rf "$tmp"
}

# Downloads Postgres.app and puts it in Applications, after Apple has confirmed
# that it is the genuine, notarized app.
agora_install_postgres () {
  [[ -x "$AGORA_PG_BIN/postgres" ]] && return
  if [[ -d /Applications/Postgres.app ]]; then
    echo "Postgres.app is installed, but without PostgreSQL $AGORA_PG_MAJOR."
    echo "Download the version with $AGORA_PG_MAJOR from https://postgresapp.com/downloads.html,"
    echo "replace the app in Applications, and run this script again."
    return 1
  fi
  local tmp volume
  tmp="$(mktemp -d)"
  echo "  Downloading Postgres.app $AGORA_PGAPP_VERSION (PostgreSQL $AGORA_PG_MAJOR with PostGIS)"
  curl -fsSL -o "$tmp/Postgres.dmg" \
    "https://github.com/PostgresApp/PostgresApp/releases/download/v$AGORA_PGAPP_VERSION/Postgres-$AGORA_PGAPP_VERSION-$AGORA_PG_MAJOR.dmg"
  volume="$(hdiutil attach -nobrowse -readonly "$tmp/Postgres.dmg" | grep -oE '/Volumes/.*$')"
  spctl -a "$volume/Postgres.app" || { hdiutil detach -quiet "$volume"; echo "Apple did not confirm the download. Not installing it."; return 1; }
  cp -R "$volume/Postgres.app" /Applications/
  hdiutil detach -quiet "$volume"
  rm -rf "$tmp"
}

# Starts PostgreSQL and Redis if they are not running yet. Both listen only on
# this computer.
agora_start_services () {
  if ! pg_isready -q; then
    if [[ ! -f "$AGORA_PG_DATA/PG_VERSION" ]]; then
      mkdir -p "$AGORA_PG_DATA"
      # A database on your own computer, owned by your Mac user, without a password.
      initdb -D "$AGORA_PG_DATA" -U "$USER" --encoding=UTF8 --locale=en_US.UTF-8 --auth=trust >/dev/null
    fi
    pg_ctl -D "$AGORA_PG_DATA" -l "$AGORA_PG_DATA/postgresql.log" -w start >/dev/null
  fi
  if ! redis-cli -p "$AGORA_REDIS_PORT" ping >/dev/null 2>&1; then
    redis-server --daemonize yes --bind 127.0.0.1 --port "$AGORA_REDIS_PORT" \
      --dir "$AGORA_REDIS_DIR/data" --logfile "$AGORA_REDIS_DIR/redis.log"
    for _ in $(seq 1 10); do redis-cli -p "$AGORA_REDIS_PORT" ping >/dev/null 2>&1 && break; sleep 1; done
  fi
}
