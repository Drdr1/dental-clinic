#!/usr/bin/env bash
# Creates the clinic owner's login and the clinic itself. Run on the server:
#   bash 03-create-owner.sh owner@email.com 'Owner display name' 'Clinic name'
# Prints a generated password once — give it to the owner, who can change it
# later from Settings → Team → Set password.
set -euo pipefail
EMAIL="${1:?email}"; NAME="${2:?display name}"; CLINIC="${3:?clinic name}"
ENV=~/supabase/.env
SERVICE_KEY=$(grep '^SERVICE_ROLE_KEY=' "$ENV" | cut -d= -f2-)
PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)

echo "==> Creating login for $EMAIL"
RESP=$(curl -sS -X POST http://127.0.0.1:8000/auth/v1/admin/users \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
  -d "$(jq -n --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e, password:$p, email_confirm:true}')")
USER_ID=$(echo "$RESP" | jq -r '.id // empty')
[ -n "$USER_ID" ] || { echo "Failed: $RESP"; exit 1; }

echo "==> Creating clinic '$CLINIC'"
docker exec -i supabase-db psql -U postgres -d postgres \
  -v owner_id="$USER_ID" -v owner_name="$NAME" -v clinic_name="$CLINIC" \
  < "$(dirname "$0")/../sql/bootstrap-clinic.sql"

echo
echo "Owner login:  $EMAIL"
echo "Password:     $PASSWORD   (shown once — store it in a password manager)"
