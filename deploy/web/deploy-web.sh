#!/usr/bin/env bash
# Run on your laptop from ~/dental-clinic/web. Builds and uploads the app.
#   SERVER=clinic bash deploy-web.sh        (SERVER = your ssh host alias)
set -euo pipefail
SERVER="${SERVER:-clinic}"
[ -f .env.production ] || { echo "Missing .env.production (see .env.production.example)"; exit 1; }
npx tsc -b
npx vite build --mode production
rsync -az --delete dist/ "$SERVER:/srv/clinic/"
echo "Deployed. Open https://clinic.derops.dev (hard-refresh once)."
