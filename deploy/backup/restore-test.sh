#!/usr/bin/env bash
# Run on YOUR LAPTOP (where the private age key lives), not on the server.
# Downloads the newest backup, decrypts it, restores it into a throwaway
# Postgres and prints row counts. A backup you've never restored is a guess.
#   bash restore-test.sh ~/.config/clinic/backup-key.txt offsite:clinic-backups
set -euo pipefail
KEY="${1:?path to age private key}"; REMOTE="${2:?rclone remote, e.g. offsite:clinic-backups}"
WORK=$(mktemp -d); trap 'docker rm -f clinic-restore-test >/dev/null 2>&1; rm -rf "$WORK"' EXIT

LATEST=$(rclone lsf "$REMOTE" --include 'db-*.dump.age' | sort | tail -1)
[ -n "$LATEST" ] || { echo "No backups found in $REMOTE"; exit 1; }
echo "==> Latest: $LATEST"
rclone copy "$REMOTE/$LATEST" "$WORK"
age -d -i "$KEY" -o "$WORK/db.dump" "$WORK/$LATEST"

# Same image as production, so Supabase roles and extensions exist.
IMAGE=$(ssh "${SERVER:-clinic}" "docker inspect -f '{{.Config.Image}}' supabase-db" 2>/dev/null || echo supabase/postgres:17.6.1.136)
echo "==> Restoring into a temporary $IMAGE"
docker run -d --name clinic-restore-test -e POSTGRES_PASSWORD=test "$IMAGE" >/dev/null
until docker exec clinic-restore-test pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done
sleep 5
docker cp "$WORK/db.dump" clinic-restore-test:/tmp/db.dump
# Restore as supabase_admin (the real superuser) and keep ownership, so the
# auth/storage schemas come back exactly as they are in production.
ERRORS=$(docker exec clinic-restore-test pg_restore -U supabase_admin -d postgres --clean --if-exists /tmp/db.dump 2>&1 | grep -c '^pg_restore: error' || true)
echo "==> pg_restore errors: $ERRORS (a handful of \"does not exist\" errors on --clean is normal)"

echo "==> Row counts in the restored copy"
docker exec clinic-restore-test psql -U supabase_admin -d postgres -c "
  select 'patients' t, count(*) from public.patients union all
  select 'appointments', count(*) from public.appointments union all
  select 'payments', count(*) from public.payments union all
  select 'installments', count(*) from public.installments union all
  select 'prescriptions', count(*) from public.prescriptions union all
  select 'auth users', count(*) from auth.users;"
echo "Compare these with the live app. If they match, the backup is good."
