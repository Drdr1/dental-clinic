#!/usr/bin/env bash
# Nightly backup: database + uploaded files, encrypted, copied off-site.
# Config in /etc/clinic-backup/env (see README). Run by cron.
set -euo pipefail
source /etc/clinic-backup/env   # AGE_RECIPIENT, RCLONE_REMOTE, SUPABASE_DIR, HC_URL (optional)

STAMP=$(date -u +%Y%m%d-%H%M)
DIR=/var/backups/clinic
mkdir -p "$DIR"
ping_hc() { [ -n "${HC_URL:-}" ] && curl -fsS -m 10 --retry 3 "$HC_URL$1" -d "$2" >/dev/null || true; }
trap 'ping_hc /fail "backup failed on line $LINENO"' ERR
ping_hc /start ""

# 1. Database. MUST run as supabase_admin: in Supabase's image the `postgres`
#    role is not a superuser, so a dump taken as `postgres` silently omits the
#    auth/storage schemas and restores as an empty database.
docker exec supabase-db pg_dump -U supabase_admin -d postgres -Fc > "$DIR/db-$STAMP.dump"

# 1b. Verify the dump before trusting it. `pg_restore --list` only lists a
#     TABLE DATA entry for tables that actually contain rows, so a structure-only
#     or truncated dump shows very few. A healthy clinic dump has ~69.
#     A backup that can't be restored is worse than no backup: you think you're covered.
TABLES=$(docker exec -i supabase-db pg_restore --list < "$DIR/db-$STAMP.dump" | grep -c "TABLE DATA" || true)
if [ "$TABLES" -lt 20 ]; then
  rm -f "$DIR/db-$STAMP.dump"
  ping_hc /fail "dump verification failed: only $TABLES tables with data"
  echo "Dump verification failed — only $TABLES tables with data (expected 20+)" >&2
  exit 1
fi

# 2. Uploaded files (X-rays, photos, PDFs)
tar -C "$SUPABASE_DIR/volumes" -czf "$DIR/storage-$STAMP.tar.gz" storage

# 3. Encrypt with the PUBLIC key only — the server can't decrypt its own backups.
for f in "$DIR/db-$STAMP.dump" "$DIR/storage-$STAMP.tar.gz"; do
  age -r "$AGE_RECIPIENT" -o "$f.age" "$f" && rm -f "$f"
done

# 4. Off-site copy, keep 30 days there and 7 days here
rclone copy "$DIR" "$RCLONE_REMOTE" --include "*-$STAMP.*"
rclone delete "$RCLONE_REMOTE" --min-age 30d
find "$DIR" -name '*.age' -mtime +7 -delete

# 5. Disk check: warn at 80% so X-rays never fill the server silently
USED=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "$USED" -ge 80 ]; then ping_hc /fail "disk ${USED}% full"; exit 0; fi

SIZE=$(du -ch "$DIR"/*-"$STAMP".*.age | tail -1 | cut -f1)
ping_hc "" "ok $STAMP size=$SIZE disk=${USED}%"
