-- =====================================================================
-- Dental Clinic System — migration 0025: what the management fee is
-- Requires: 0024
--
-- The percentage is only a suggestion the app offers when the fee is
-- entered; nothing is posted automatically, because the owners settle
-- it themselves at the end of the month.
-- =====================================================================

alter table public.clinics
  add column if not exists admin_percent numeric(5,2) not null default 5
    check (admin_percent >= 0 and admin_percent <= 100);
