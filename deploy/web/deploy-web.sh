#!/usr/bin/env bash
# Run on your laptop from ~/dental-clinic/web. Builds and uploads the app.
#   SERVER=clinic bash deploy-web.sh                        live server (.env.production)
#   SERVER=dentano-test MODE=staging bash deploy-web.sh     test server (.env.staging)
set -euo pipefail
SERVER="${SERVER:-clinic}"
MODE="${MODE:-production}"
[ -f ".env.$MODE" ] || { echo "Missing .env.$MODE (needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY)"; exit 1; }
npx tsc -b
npx vite build --mode "$MODE"
rsync -az --delete dist/ "$SERVER:/srv/clinic/"
if [ "$MODE" = staging ]; then
  echo "Deployed. Open https://test.dentano.app (hard-refresh once)."
else
  echo "Deployed. Open https://my.dentano.app (hard-refresh once)."
fi
