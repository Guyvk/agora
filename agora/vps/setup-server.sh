#!/bin/bash
#
# Agora: turn a fresh Infomaniak VPS Lite (Ubuntu 24.04) into Agora's server.
#
# Run it once on the server, as the administrator, with Agora's address:
#
#   curl -fsSLO https://raw.githubusercontent.com/Guyvk/agora/agora/agora/vps/setup-server.sh
#   sudo bash setup-server.sh agora.7billionpresidents.org
#
# The address must already point at this server (an A record in the domain's
# DNS), so the certificate for https can be made. It is safe to run again:
# every step first checks whether it has been done.
#
# What ends up on the server:
#   /srv/agora               Agora's code, owned by the user "agora"
#   /var/lib/agora/uploads   profile pictures, banners and attachments people
#                            upload, readable by the user "agora" only
#   PostgreSQL with PostGIS  the database "agora", only reachable from this server
#   Redis                    the job queue, only reachable from this server
#   Caddy                    the web server in front, with https certificates
#   systemd services         agora-api, agora-worker, agora-web, and timers for
#                            the scheduled jobs and a nightly database backup
#   /var/backups/agora       the nightly backups (database and uploads), kept for 14 days
#
# Later updates: sudo /srv/agora/agora/vps/update.sh
#
set -euo pipefail

SITE="${1:-}"
REPO="${AGORA_REPO:-https://github.com/Guyvk/agora.git}"
BRANCH="${AGORA_BRANCH:-agora}"
APP_DIR=/srv/agora
APP_USER=agora
NODE_VERSION="v24.21.0"
NODE_DIR=/opt/agora-node24
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
as_agora() { sudo -u "$APP_USER" -H env "PATH=$NODE_DIR/bin:/usr/bin:/bin" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"; }

if [[ -z "$SITE" ]]; then
  echo "Give Agora's address, for example: sudo bash setup-server.sh agora.7billionpresidents.org"
  exit 1
fi
[[ "$(id -u)" == "0" ]] || { echo "Run this with sudo."; exit 1; }
if ! grep -q 'VERSION_ID="24.04"' /etc/os-release; then
  echo "This script is written for Ubuntu 24.04. Found: $(. /etc/os-release; echo "$PRETTY_NAME")."
  echo "Press Enter to try anyway, or Ctrl-C to stop."
  read -r
fi
export DEBIAN_FRONTEND=noninteractive

step "1/10  Updating the server and installing what Agora needs"
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl git ufw fail2ban unattended-upgrades \
  build-essential python3 rsync postgresql postgresql-contrib redis-server caddy >/dev/null
PG_MAJOR="$(apt-cache depends postgresql | sed -n 's/.*Depends: postgresql-\([0-9]*\)$/\1/p' | head -1)"
apt-get install -y -qq "postgresql-$PG_MAJOR-postgis-3" >/dev/null
echo "  PostgreSQL $PG_MAJOR, Redis $(redis-server --version | awk '{print $3}'), Caddy $(caddy version | awk '{print $1}')"

step "2/10  Security: firewall, automatic security updates, login protection"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now fail2ban >/dev/null 2>&1
# Logging in with a password is turned off, but only when someone can already
# log in with a key. Otherwise nobody could get back in.
if find /root/.ssh /home/*/.ssh -name authorized_keys -size +0 2>/dev/null | grep -q .; then
  printf '# Agora: log in with a key only\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n' \
    > /etc/ssh/sshd_config.d/10-agora.conf
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  echo "  Firewall on (ssh, http, https). Logging in works with a key only."
else
  echo "  Firewall on (ssh, http, https). No ssh key found, so password login stays on."
fi

step "3/10  Extra memory on disk (swap), for building the web app"
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "  4 GB swap added."
else
  echo "  Swap is already there."
fi

step "4/10  Installing Node 24"
if [[ ! -x "$NODE_DIR/bin/node" ]] || [[ "$("$NODE_DIR/bin/node" -v)" != "$NODE_VERSION" ]]; then
  arch="$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')"
  file="node-$NODE_VERSION-linux-$arch.tar.xz"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/$file" "https://nodejs.org/dist/$NODE_VERSION/$file"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet)
  tar -xJf "$tmp/$file" -C "$tmp"
  rm -rf "$NODE_DIR"
  mv "$tmp/${file%.tar.xz}" "$NODE_DIR"
  rm -rf "$tmp"
fi
"$NODE_DIR/bin/corepack" enable
echo "  Node $("$NODE_DIR/bin/node" -v)"

step "5/10  Agora's own user and code"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /bin/bash "$APP_USER"
if [[ ! -d "$APP_DIR/.git" ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  as_agora git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
echo "  $(as_agora git -C "$APP_DIR" log --oneline -1)"
# Uploads live outside the code, so updates never touch them. Only the user
# "agora" can read them: Agora's server hands them out at /noo/uploads/...
install -d -o "$APP_USER" -g "$APP_USER" -m 750 /var/lib/agora /var/lib/agora/uploads
echo "  Uploads go to /var/lib/agora/uploads"

step "6/10  The database and the job queue"
systemctl enable --now postgresql redis-server >/dev/null 2>&1
# Redis only listens on this server (Ubuntu's default, checked here).
grep -q '^bind 127.0.0.1' /etc/redis/redis.conf || { echo "Redis listens on more than this server. Check /etc/redis/redis.conf."; exit 1; }
# Hylo connects to its database with encryption in production. Ubuntu's
# PostgreSQL has it on by default; this checks it.
[[ "$(sudo -u postgres psql -tAc 'show ssl')" == "on" ]] || { echo "PostgreSQL has encryption (ssl) off. Hylo needs it on."; exit 1; }
# Three programs keep up to 30 connections each, plus the scheduled jobs.
if [[ "$(sudo -u postgres psql -tAc 'show max_connections')" -lt 200 ]]; then
  sudo -u postgres psql -qc 'alter system set max_connections = 200' >/dev/null
  systemctl restart postgresql
fi
password_file="/home/$APP_USER/.agora-db-password"
if [[ ! -f "$password_file" ]]; then
  (umask 077; openssl rand -hex 24 > "$password_file")
  chown "$APP_USER:$APP_USER" "$password_file"
fi
DB_PASSWORD="$(cat "$password_file")"
if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='agora'" | grep -q 1; then
  sudo -u postgres psql -qc "create role agora login password '$DB_PASSWORD'"
fi
if ! sudo -u postgres psql -lqt | cut -d '|' -f 1 | grep -qw agora; then
  sudo -u postgres createdb -O agora agora
  # Only the database administrator may add these, so it does that first.
  for ext in postgis pg_stat_statements uuid-ossp; do
    sudo -u postgres psql -q -d agora -c "create extension if not exists \"$ext\" with schema public"
  done
  NEW_DATABASE=1
fi

step "7/10  Settings"
as_agora bash -c "cd '$APP_DIR' && node agora/vps/server-env.mjs '$SITE' '$DB_PASSWORD'"

step "8/10  Installing Agora's building blocks and building the web app (the slow part, 15 to 30 minutes)"
as_agora bash -c "cd '$APP_DIR' && export ELECTRON_SKIP_BINARY_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1 && (yarn install || yarn install) && yarn build-packages"
as_agora bash -c "cd '$APP_DIR/apps/web' && NODE_OPTIONS=--max-old-space-size=3072 node scripts/build.js >/dev/null && touch dist/.agora-built"

if [[ "${NEW_DATABASE:-0}" == 1 ]]; then
  echo "  Filling the new database."
  # The comments on the extensions belong to the administrator, so they are skipped.
  sed '/^COMMENT ON EXTENSION/d' "$APP_DIR/apps/backend/migrations/schema.sql" \
    | PGPASSWORD="$DB_PASSWORD" psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U agora agora >/dev/null
  # Tell the migration tool that everything in schema.sql is already in place.
  as_agora bash -c "cd '$APP_DIR/apps/backend' && yarn knex seed:run --specific=migrations.js >/dev/null"
fi
as_agora bash -c "cd '$APP_DIR/apps/backend' && yarn migrate >/dev/null"
# What stewards may do (invite people and so on): schema.sql has no rows for it.
as_agora bash -c "cd '$APP_DIR/apps/backend' && node scripts/agora-steward-roles.js"
echo "  The database is up to date. No demo data: this is the real Agora."

step "9/10  Services, scheduled jobs and backups"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 /var/backups/agora
unit () { cat > "/etc/systemd/system/$1"; }
service_common="User=$APP_USER
Environment=PATH=$NODE_DIR/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Restart=always
RestartSec=5"

unit agora-api.service <<EOF
[Unit]
Description=Agora server
After=network.target postgresql.service redis-server.service
[Service]
WorkingDirectory=$APP_DIR/apps/backend
Environment=PORT=3001
ExecStart=$NODE_DIR/bin/node app.js
$service_common
[Install]
WantedBy=multi-user.target
EOF

unit agora-worker.service <<EOF
[Unit]
Description=Agora background worker (emails, minutes)
After=network.target postgresql.service redis-server.service
[Service]
WorkingDirectory=$APP_DIR/apps/backend
ExecStart=$NODE_DIR/bin/node --env-file=.env worker.js
$service_common
[Install]
WantedBy=multi-user.target
EOF

unit agora-web.service <<EOF
[Unit]
Description=Agora web app
After=network.target agora-api.service
[Service]
WorkingDirectory=$APP_DIR/apps/web
Environment=PORT=3000
ExecStart=$NODE_DIR/bin/node src/server/index.js
$service_common
[Install]
WantedBy=multi-user.target
EOF

unit agora-cron@.service <<EOF
[Unit]
Description=Agora scheduled job (%i)
After=agora-api.service
[Service]
Type=oneshot
User=$APP_USER
Environment=PATH=$NODE_DIR/bin:/usr/bin:/bin
Environment=NODE_ENV=production
WorkingDirectory=$APP_DIR/apps/backend
ExecStart=$NODE_DIR/bin/node --env-file=.env cron.js --interval %i
EOF

timer () {
  unit "agora-cron-$1.timer" <<EOF
[Unit]
Description=Agora scheduled job ($1)
[Timer]
OnCalendar=$2
Unit=agora-cron@$1.service
Persistent=true
[Install]
WantedBy=timers.target
EOF
}
timer every10minutes '*:0/10'
timer hourly 'hourly'
timer daily '*-*-* 03:30'

unit agora-backup.service <<EOF
[Unit]
Description=Agora nightly backup of the database and the uploads
[Service]
Type=oneshot
User=$APP_USER
ExecStart=/bin/bash $APP_DIR/agora/vps/backup.sh
EOF
unit agora-backup.timer <<EOF
[Unit]
Description=Agora nightly backup of the database and the uploads
[Timer]
OnCalendar=*-*-* 02:30
Persistent=true
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now agora-api agora-worker agora-web >/dev/null 2>&1
systemctl restart agora-api agora-worker agora-web
systemctl enable --now agora-cron-every10minutes.timer agora-cron-hourly.timer agora-cron-daily.timer agora-backup.timer >/dev/null 2>&1

step "10/10  The web server in front, with https"
cat > /etc/caddy/Caddyfile <<EOF
# Agora: one address. /noo and /socket.io go to Agora's server, the rest to the web app.
$SITE {
	encode zstd gzip
	@api path /noo/* /socket.io/*
	reverse_proxy @api 127.0.0.1:3001
	reverse_proxy 127.0.0.1:3000
}
EOF
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo
echo "  Waiting for Agora to start..."
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null http://127.0.0.1:3000/ 2>/dev/null && break
  sleep 2
done

cat <<DONE

Done. Open https://$SITE
(The https certificate is made on the first visit. If the address does not
point at this server yet, Caddy keeps trying until it does.)

Emails are written to the log for now, not sent. To read a sign-up code:
  sudo journalctl -u agora-worker -n 50
To send real email, add the mailbox settings (see "Going online" in README-AGORA.md).

Useful commands:
  sudo systemctl status agora-api agora-worker agora-web   is everything running?
  sudo journalctl -u agora-api -f                          the server's log
  sudo /srv/agora/agora/vps/update.sh                      bring in a new version
DONE
