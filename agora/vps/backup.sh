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
# These backups sit on the same server. A copy elsewhere (Infomaniak's Swiss
# Backup) is still to be set up; see "Going online" in README-AGORA.md.
#
set -euo pipefail
dir=/var/backups/agora
today="$(date +%F)"
PGPASSWORD="$(cat "$HOME/.agora-db-password")" \
  pg_dump -h 127.0.0.1 -U agora -Fc agora > "$dir/agora-$today.dump.part"
mv "$dir/agora-$today.dump.part" "$dir/agora-$today.dump"
find "$dir" -name 'agora-*.dump' -mtime +14 -delete

uploads=/var/lib/agora/uploads
if [[ -d "$uploads" ]]; then
  # Uploads that broke off halfway leave a hidden ".part" file. After two hours
  # nobody is writing it any more.
  find "$uploads" -type f -name '*.part' -mmin +120 -delete
  # The newest earlier night, whose unchanged files are shared instead of copied.
  previous="$(find "$dir" -maxdepth 1 -type d -name 'uploads-????-??-??' ! -name "uploads-$today" | sort | tail -1)"
  rsync -a --delete --exclude='*.part' ${previous:+--link-dest="$previous"} "$uploads/" "$dir/uploads-$today.part/"
  rm -rf "$dir/uploads-$today"
  mv "$dir/uploads-$today.part" "$dir/uploads-$today"
  touch "$dir/uploads-$today"
  find "$dir" -maxdepth 1 -type d -name 'uploads-????-??-??' -mtime +14 -exec rm -rf {} +
fi
