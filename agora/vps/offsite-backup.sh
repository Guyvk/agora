#!/bin/bash
#
# Agora: a copy of the nightly backup away from the server, in Infomaniak's
# object storage (the same Public Cloud project, S3 speaking). If the server is
# lost, its own backups in /var/backups/agora are lost with it; this copy is not.
#
# It is optional. Without the settings file /etc/agora/offsite-backup.conf it
# prints one line and does nothing. How to switch it on and how to restore:
# "Off-server backups" in README-AGORA.md.
#
#   offsite-backup.sh upload [date]         copy that night's backup (backup.sh does this)
#   offsite-backup.sh check                 test the settings, make the container
#   offsite-backup.sh list                  show what is stored
#   offsite-backup.sh fetch <folder> [date] download a backup to restore it
#   offsite-backup.sh prepare               install rclone and /etc/agora (as root;
#                                           setup-server.sh and update.sh do this)
#
# Run the first four as the user "agora": sudo -u agora bash offsite-backup.sh check
#
# What is stored, with rclone (a well known copying tool, from Ubuntu itself):
#   db/agora-<date>.dump      the database of each night, for OFFSITE_KEEP_DAYS days
#   uploads/current/          the uploads as they are now
#   uploads/changed-<date>/   uploads changed or deleted that night, the old
#                             version, kept for OFFSITE_KEEP_DAYS days
#   settings/backend.env      the server's settings files of the last night
#   settings/web.env          (only when encryption is on, they hold keys)
# With encryption on (the default), everything, file names too, is encrypted
# on the server before it leaves, and the storage only sees scrambled data.
#
set -euo pipefail
umask 077

CONF="${AGORA_OFFSITE_CONF:-/etc/agora/offsite-backup.conf}"
BACKUP_DIR="${AGORA_BACKUP_DIR:-/var/backups/agora}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_USER=agora
README_HINT='see "Off-server backups" in README-AGORA.md'

say() { echo "Off-server copy: $*"; }
die() { echo "Off-server copy failed: $*" >&2; exit 1; }

# "N days ago" as 2026-10-19, with GNU date (the server) or BSD date (a Mac).
days_ago() { date -d "$1 days ago" +%F 2>/dev/null || date -v-"$1"d +%F; }

prepare() {
  [[ "$(id -u)" == 0 ]] || die "run prepare with sudo."
  if ! command -v rclone >/dev/null 2>&1; then
    apt-get install -y -qq rclone >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq rclone >/dev/null; }
  fi
  # Only root may change these files; the user "agora" may read them.
  install -d -o root -g "$APP_USER" -m 750 /etc/agora
  install -o root -g "$APP_USER" -m 640 "$APP_DIR/agora/vps/offsite-backup.conf.example" /etc/agora/offsite-backup.conf.example
  if [[ -f "$CONF" ]]; then
    chown root:"$APP_USER" "$CONF"
    chmod 640 "$CONF"
    say "on ($CONF exists), rclone $(rclone version | awk 'NR==1{print $2}')."
  else
    say "ready, not switched on yet ($README_HINT)."
  fi
}

# Reads NAME=value lines. Nothing in the file is run as a command, and values
# are never printed, because they hold keys.
read_settings() {
  [[ -r "$CONF" ]] || die "cannot read $CONF (run this as the user agora: sudo -u agora bash $0 ...)."
  local line number=0 key value
  ENDPOINT=https://s3.pub2.infomaniak.cloud BUCKET=agora-backups ACCESS_KEY='' SECRET_KEY=''
  PASSWORD='' ENCRYPT=yes KEEP_DAYS=30
  while IFS= read -r line || [[ -n "$line" ]]; do
    number=$((number + 1))
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*(OFFSITE_[A-Z_]+)=(.*)$ ]] || die "line $number of $CONF is not NAME=value."
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
    case "$key" in
      OFFSITE_ENDPOINT) ENDPOINT="$value" ;;
      OFFSITE_BUCKET) BUCKET="$value" ;;
      OFFSITE_ACCESS_KEY) ACCESS_KEY="$value" ;;
      OFFSITE_SECRET_KEY) SECRET_KEY="$value" ;;
      OFFSITE_PASSWORD) PASSWORD="$value" ;;
      OFFSITE_ENCRYPT) ENCRYPT="$value" ;;
      OFFSITE_KEEP_DAYS) KEEP_DAYS="$value" ;;
      *) die "line $number of $CONF: unknown setting $key." ;;
    esac
  done < "$CONF"
  [[ -n "$ACCESS_KEY" && -n "$SECRET_KEY" ]] || die "OFFSITE_ACCESS_KEY and OFFSITE_SECRET_KEY must be filled in, in $CONF."
  [[ "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die "OFFSITE_BUCKET may only have small letters, digits, dots and dashes."
  [[ "$KEEP_DAYS" =~ ^[0-9]+$ && "$KEEP_DAYS" -ge 1 ]] || die "OFFSITE_KEEP_DAYS must be a number of days, 1 or more."
  case "$ENCRYPT" in
    yes) [[ ${#PASSWORD} -ge 12 ]] || die "OFFSITE_PASSWORD must be at least 12 characters (20 or more is better)." ;;
    no) ;;
    *) die "OFFSITE_ENCRYPT must be yes or no." ;;
  esac
  command -v rclone >/dev/null 2>&1 || die "rclone is not installed. Run: sudo bash $APP_DIR/agora/vps/offsite-backup.sh prepare"
}

# rclone gets its settings from the environment, which only this user and root
# can see, so no rclone settings file with keys is written anywhere.
connect() {
  read_settings
  export RCLONE_CONFIG=/dev/null
  export RCLONE_CONFIG_AGORAS3_TYPE=s3
  export RCLONE_CONFIG_AGORAS3_PROVIDER=Other
  export RCLONE_CONFIG_AGORAS3_ENV_AUTH=false
  export RCLONE_CONFIG_AGORAS3_ACCESS_KEY_ID="$ACCESS_KEY"
  export RCLONE_CONFIG_AGORAS3_SECRET_ACCESS_KEY="$SECRET_KEY"
  export RCLONE_CONFIG_AGORAS3_ENDPOINT="$ENDPOINT"
  export RCLONE_CONFIG_AGORAS3_REGION=us-east-1
  export RCLONE_CONFIG_AGORAS3_FORCE_PATH_STYLE=true
  if [[ "$ENCRYPT" == yes ]]; then
    export RCLONE_CONFIG_AGORACRYPT_TYPE=crypt
    export RCLONE_CONFIG_AGORACRYPT_REMOTE="agoras3:$BUCKET/encrypted"
    # rclone wants the password in its own scrambled form; it reads it from
    # stdin here, so it never shows up in the list of running programs.
    RCLONE_CONFIG_AGORACRYPT_PASSWORD="$(printf '%s\n' "$PASSWORD" | rclone obscure -)"
    export RCLONE_CONFIG_AGORACRYPT_PASSWORD
    REMOTE=agoracrypt:
  else
    REMOTE="agoras3:$BUCKET/plain/"
  fi
  unset PASSWORD SECRET_KEY
  # Errors are still shown. If the storage cannot be reached, it gives up
  # after a few minutes instead of trying for a long time.
  RC=(rclone --quiet --retries 3 --retries-sleep 10s --low-level-retries 3 --contimeout 30s --timeout 5m)
}

lock() {
  command -v flock >/dev/null 2>&1 || return 0
  exec 9>"$BACKUP_DIR/.offsite.lock"
  flock -n 9 || die "another off-server copy is still running."
}

upload() {
  if [[ ! -e "$CONF" ]]; then
    say "not set up, the backup stays on this server only ($README_HINT)."
    return 0
  fi
  local day="${1:-$(date +%F)}"
  [[ "$day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "a date looks like 2026-10-19."
  connect
  lock
  local dump="$BACKUP_DIR/agora-$day.dump" snapshot="$BACKUP_DIR/uploads-$day" what="database"
  [[ -f "$dump" ]] || die "$dump does not exist. Run backup.sh first."

  "${RC[@]}" copyto "$dump" "${REMOTE}db/agora-$day.dump"

  # The uploads: a mirror of tonight's snapshot. What changed or disappeared
  # since the last copy is moved aside into changed-<date> instead of lost.
  if [[ -d "$snapshot" ]]; then
    "${RC[@]}" sync --fast-list "$snapshot/" "${REMOTE}uploads/current" \
      --backup-dir "${REMOTE}uploads/changed-$day"
    what="$what, uploads"
  fi

  # The settings files hold every key, so they only go when encrypted.
  if [[ "$ENCRYPT" == yes ]]; then
    local app file
    for app in backend web; do
      file="$APP_DIR/apps/$app/.env"
      if [[ -r "$file" ]]; then
        "${RC[@]}" copyto "$file" "${REMOTE}settings/$app.env"
        what="$what, $app settings"
      fi
    done
  fi

  # Older than OFFSITE_KEEP_DAYS: away. Decided by the date in the name, never
  # by the clock of the storage, and only after tonight's copy succeeded.
  local cutoff name removed=0
  cutoff="$(days_ago "$KEEP_DAYS")"
  while IFS= read -r name; do
    if [[ "$name" =~ ^agora-([0-9]{4}-[0-9]{2}-[0-9]{2})\.dump$ && "${BASH_REMATCH[1]}" < "$cutoff" ]]; then
      "${RC[@]}" deletefile "${REMOTE}db/$name"
      removed=$((removed + 1))
    fi
  done < <("${RC[@]}" lsf --files-only "${REMOTE}db")
  while IFS= read -r name; do
    if [[ "$name" =~ ^changed-([0-9]{4}-[0-9]{2}-[0-9]{2})/$ && "${BASH_REMATCH[1]}" < "$cutoff" ]]; then
      "${RC[@]}" purge "${REMOTE}uploads/${name%/}"
      removed=$((removed + 1))
    fi
  done < <("${RC[@]}" lsf --dirs-only "${REMOTE}uploads" 2>/dev/null || true)

  # A mark with the time of the last copy that worked, for the admin dashboard
  touch "$BACKUP_DIR/.offsite-last-done" 2>/dev/null || true
  say "done for $day ($what) to $BUCKET, encrypted: $ENCRYPT, kept $KEEP_DAYS days, $removed old part(s) removed."
}

check() {
  [[ -e "$CONF" ]] || die "$CONF does not exist yet ($README_HINT)."
  connect
  echo "Settings read. Container: $BUCKET at $ENDPOINT, encrypted: $ENCRYPT, kept $KEEP_DAYS days."
  "${RC[@]}" mkdir "agoras3:$BUCKET"
  local word
  word="agora-check-$(date +%s)"
  printf '%s\n' "$word" | "${RC[@]}" rcat "${REMOTE}check.txt"
  [[ "$("${RC[@]}" cat "${REMOTE}check.txt")" == "$word" ]] || die "wrote a test file but read back something else."
  "${RC[@]}" deletefile "${REMOTE}check.txt"
  echo "It works: a test file was written, read back and removed."
}

list() {
  [[ -e "$CONF" ]] || die "$CONF does not exist yet ($README_HINT)."
  connect
  echo "Database copies (size in bytes, name):"
  "${RC[@]}" lsf --files-only --format sp --separator '  ' "${REMOTE}db" 2>/dev/null | sort -k2 || true
  echo "Uploads:"
  "${RC[@]}" lsf --dirs-only "${REMOTE}uploads" 2>/dev/null || true
  echo "In total:"
  "${RC[@]}" size "$REMOTE" 2>/dev/null || true
}

fetch() {
  local target="${1:-}" day="${2:-}"
  [[ -n "$target" ]] || die "say where to put it, for example: fetch /var/backups/agora/restore"
  [[ -e "$CONF" ]] || die "$CONF does not exist yet ($README_HINT)."
  connect
  if [[ -z "$day" ]]; then
    day="$("${RC[@]}" lsf --files-only "${REMOTE}db" | sed -n 's/^agora-\([0-9-]*\)\.dump$/\1/p' | sort | tail -1)"
    [[ -n "$day" ]] || die "no database copy found in $BUCKET. Is OFFSITE_PASSWORD the same as when the copies were made?"
  fi
  mkdir -p "$target"
  echo "Fetching the database of $day"
  "${RC[@]}" copyto "${REMOTE}db/agora-$day.dump" "$target/agora-$day.dump"
  local top
  top="$("${RC[@]}" lsf --dirs-only "$REMOTE")"
  if grep -qx 'uploads/' <<<"$top"; then
    echo "Fetching the uploads (the newest version)"
    "${RC[@]}" copy "${REMOTE}uploads/current" "$target/uploads"
  else
    echo "  No uploads stored."
  fi
  if grep -qx 'settings/' <<<"$top"; then
    echo "Fetching the settings files"
    "${RC[@]}" copy "${REMOTE}settings" "$target/settings"
  fi
  echo "Done. In $target: agora-$day.dump, uploads/, settings/. Next steps: \"Restoring\" in README-AGORA.md."
}

case "${1:-}" in
  upload) upload "${2:-}" ;;
  check) check ;;
  list) list ;;
  fetch) fetch "${2:-}" "${3:-}" ;;
  prepare) prepare ;;
  *) echo "Usage: $0 upload [date] | check | list | fetch <folder> [date] | prepare"; exit 1 ;;
esac
