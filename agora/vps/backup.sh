#!/bin/bash
#
# Agora: a backup of the database and of the uploads (profile pictures,
# banners, attachments), made every night by the agora-backup timer.
# Kept in /var/backups/agora for 14 days. Run by hand: sudo -u agora bash backup.sh
#
# The uploads are copied as a folder per night (uploads-<date>). A file that
# did not change since the night before is not stored again: both nights share
# it on disk (a "hard link"), so 14 nights cost little more than one copy plus
# what was added. To bring back the uploads of a night:
#   sudo rsync -a /var/backups/agora/uploads-<date>/ /var/lib/agora/uploads/
#
# These backups sit on the same server. When /etc/agora/offsite-backup.conf
# exists, offsite-backup.sh then also copies them, encrypted, to Infomaniak's
# object storage, away from this server. Without that file it says so in one
# line. AGORA_OFFSITE=off skips the copy for one run (update.sh does that).
# See "Off-server backups" in README-AGORA.md.
#
set -euo pipefail
dir="${AGORA_BACKUP_DIR:-/var/backups/agora}"
today="$(date +%F)"
PGPASSWORD="$(cat "$HOME/.agora-db-password")" \
  pg_dump -h 127.0.0.1 -U agora -Fc agora > "$dir/agora-$today.dump.part"
mv "$dir/agora-$today.dump.part" "$dir/agora-$today.dump"
find "$dir" -name 'agora-*.dump' -mtime +14 -delete

uploads=/var/lib/agora/uploads
if [[ -d "$uploads" ]]; then
  # Uploads that broke off halfway leave a hidden ".part" file. After two hours
  # nobody is writing it any more.
  find "$uploads" -type f -name '.*.part' -mmin +120 -delete
  # The newest earlier night, whose unchanged files are shared instead of copied.
  previous="$(find "$dir" -maxdepth 1 -type d -name 'uploads-????-??-??' ! -name "uploads-$today" | sort | tail -1)"
  rsync -a --delete --exclude='.*.part' ${previous:+--link-dest="$previous"} "$uploads/" "$dir/uploads-$today.part/"
  rm -rf "$dir/uploads-$today"
  mv "$dir/uploads-$today.part" "$dir/uploads-$today"
  touch "$dir/uploads-$today"
  find "$dir" -maxdepth 1 -type d -name 'uploads-????-??-??' -mtime +14 -exec rm -rf {} +
fi

# The copy away from this server. If it fails, the backup on this server is
# still complete, but the nightly job shows as failed (systemctl status agora-backup).
if [[ "${AGORA_OFFSITE:-on}" == off ]]; then
  echo "Off-server copy: skipped for this run (AGORA_OFFSITE=off)."
else
  bash "$(dirname "${BASH_SOURCE[0]}")/offsite-backup.sh" upload "$today"
fi
