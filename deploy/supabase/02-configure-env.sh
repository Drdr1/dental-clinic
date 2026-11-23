#!/usr/bin/env bash
# Sets the clinic's production values in ~/supabase/.env.
# Run from ~/supabase AFTER utils/generate-keys.sh and utils/add-new-auth-keys.sh.
set -euo pipefail
APP="${1:-https://my.dentano.app}"
API="${2:-https://api.dentano.app}"
[ -f .env ] || { echo "Run from ~/supabase (no .env here)"; exit 1; }
cp .env ".env.bak.$(date +%s)"

set_var() {  # set_var KEY VALUE — replace if present, append if not
  local k="$1" v="$2"
  if grep -q "^${k}=" .env; then
    sed -i "s|^${k}=.*|${k}=${v}|" .env
  else
    echo "${k}=${v}" >> .env
  fi
}

# Load our override file too (the official .env limits Compose to the base file).
set_var COMPOSE_FILE "docker-compose.yml:docker-compose.override.yml"

set_var SUPABASE_PUBLIC_URL "$API"
set_var API_EXTERNAL_URL "$API/auth/v1"
set_var SITE_URL "$APP"
set_var ADDITIONAL_REDIRECT_URLS "$APP,https://clinic.derops.dev"
set_var CLINIC_APP_ORIGIN "$APP"
# The iOS app's origin, plus the old address for phone apps installed before the move.
set_var CLINIC_EXTRA_ORIGINS "capacitor://${APP#https://},https://clinic.derops.dev,capacitor://clinic.derops.dev"

# Staff accounts are created by the owner from Settings only.
set_var DISABLE_SIGNUP "true"
set_var ENABLE_EMAIL_SIGNUP "true"      # email+password login stays on
set_var ENABLE_EMAIL_AUTOCONFIRM "true" # no SMTP; owner-created accounts are pre-confirmed
set_var ENABLE_PHONE_SIGNUP "false"
set_var ENABLE_ANONYMOUS_USERS "false"

# The staff function checks the caller itself.
set_var FUNCTIONS_VERIFY_JWT "false"

set_var STUDIO_DEFAULT_ORGANIZATION "DerOps"
set_var STUDIO_DEFAULT_PROJECT "Clinic"
set_var OPENAI_API_KEY ""

echo "Updated .env. Values you'll need later:"
grep -E '^(SUPABASE_PUBLISHABLE_KEY|POSTGRES_PASSWORD|DASHBOARD_USERNAME|DASHBOARD_PASSWORD)=' .env
