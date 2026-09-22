#!/usr/bin/env bash
# Run on your laptop from ~/dental-clinic. Applies supabase/migrations to production
# through an SSH tunnel (Postgres is never exposed to the internet).
#   SERVER=clinic PGPASS='<POSTGRES_PASSWORD from server .env>' bash db-push.sh
set -euo pipefail
SERVER="${SERVER:-clinic}"; : "${PGPASS:?set PGPASS}"
ssh -fN -o ExitOnForwardFailure=yes -L 55432:127.0.0.1:5432 "$SERVER"
trap 'pkill -f "55432:127.0.0.1:5432" || true' EXIT
npx supabase db push --db-url "postgresql://postgres:${PGPASS}@127.0.0.1:55432/postgres?sslmode=disable"
