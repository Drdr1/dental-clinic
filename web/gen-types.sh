#!/usr/bin/env bash
# Regenerate web/src/types/database.ts from production, through the SSH tunnel.
# Run on your laptop from ~/dental-clinic, AFTER db-push.sh:
#   SERVER=clinic PGPASS='<POSTGRES_PASSWORD from the server .env>' bash web/gen-types.sh
#
# New tables and functions (partners, clinic_profit, lab_cases.doctor_id …) do not
# exist for TypeScript until this runs, and `npm run build` fails without it.
set -euo pipefail
SERVER="${SERVER:-clinic}"; : "${PGPASS:?set PGPASS}"
OUT="${OUT:-web/src/types/database.ts}"

ssh -fN -o ExitOnForwardFailure=yes -L 55432:127.0.0.1:5432 "$SERVER"
trap 'pkill -f "55432:127.0.0.1:5432" || true' EXIT

tmp=$(mktemp)
npx supabase gen types typescript \
  --db-url "postgresql://postgres:${PGPASS}@127.0.0.1:55432/postgres?sslmode=disable" > "$tmp"

# Only overwrite once we know the dump is a real file, never a half-written one.
grep -q "partners" "$tmp" || { echo "Generated types are missing 'partners' — did db push run?"; exit 1; }
mv "$tmp" "$OUT"
echo "Wrote $OUT"
