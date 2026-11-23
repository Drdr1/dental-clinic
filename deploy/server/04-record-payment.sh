#!/usr/bin/env bash
# Records a clinic's subscription payment and moves its renewal date forward.
# Run on the server:
#   bash 04-record-payment.sh 'Clinic name' <amount> <months> <method> [reference]
#   bash 04-record-payment.sh 'عيادة النور' 799 1 instapay 'IP-12345'
# With no amount, prints every clinic's plan state instead.
set -euo pipefail
PSQL=(docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1)

if [ $# -lt 1 ] || [ -z "${2:-}" ]; then
  "${PSQL[@]}" -c "select name, plan_status, public.clinic_plan_state(id) as state, trial_ends_on, plan_renews_on, plan_price
                   from public.clinics order by name"
  exit 0
fi

CLINIC="$1"; AMOUNT="$2"; MONTHS="${3:?months}"; METHOD="${4:?method}"; REF="${5:-}"
"${PSQL[@]}" -v clinic="$CLINIC" -v amount="$AMOUNT" -v months="$MONTHS" -v method="$METHOD" -v ref="$REF" <<'SQL'
select public.record_subscription_payment(
  (select id from public.clinics where name = :'clinic' order by created_at limit 1),
  :'amount'::numeric, :'months'::int, :'method', nullif(:'ref', '')) as renews_on;
SQL
