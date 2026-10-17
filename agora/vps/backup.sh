#!/bin/bash
#
# Agora: a backup of the database, made every night by the agora-backup timer.
# Kept in /var/backups/agora for 14 days. Run by hand: sudo -u agora bash backup.sh
#
# These backups sit on the same server. A copy elsewhere (Infomaniak's Swiss
# Backup) is still to be set up; see "Going online" in README-AGORA.md.
#
set -euo pipefail
dir=/var/backups/agora
PGPASSWORD="$(cat "$HOME/.agora-db-password")" \
  pg_dump -h 127.0.0.1 -U agora -Fc agora > "$dir/agora-$(date +%F).dump.part"
mv "$dir/agora-$(date +%F).dump.part" "$dir/agora-$(date +%F).dump"
find "$dir" -name 'agora-*.dump' -mtime +14 -delete
