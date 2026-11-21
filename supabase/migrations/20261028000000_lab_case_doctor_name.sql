-- =====================================================================
-- Dental Clinic System — migration 0040: whose case is this?
-- Requires: 0001–0039
--
-- A lab case carries the doctor it belongs to, because its fee comes off
-- that doctor's commission. The list never showed it, so a case saved
-- without a doctor looked exactly like one saved with it, and the fee
-- quietly came off nobody. The screens can now show the name — and show
-- its absence.
-- =====================================================================

drop view if exists public.lab_case_status;

create view public.lab_case_status with (security_invoker = true) as
select
  lc.*,
  l.name as lab_name,
  li.name as item_name,
  p.full_name,
  doc.display_name as doctor_name,
  case
    when lc.cancelled_at is not null        then 'cancelled'
    when lc.fitted_on is not null           then 'fitted'
    when lc.received_on is not null         then 'received'
    when t.today > lc.expected_on           then 'late'
    else 'at_lab'
  end as status,
  case
    when lc.cancelled_at is not null        then 'cancelled'
    when lc.fitted_on is not null           then 'fitted'
    when lc.received_on is not null         then 'delivered'       -- back; fit it
    when lc.tryin_done_on is not null       then 'awaiting_delivery'
    when lc.tryin_received_on is not null   then 'tryin_ready'     -- call the patient in
    when lc.needs_tryin                     then 'awaiting_tryin'  -- chase the lab
    else 'at_lab'
  end as stage,
  st.next_due,
  (st.next_due is not null and t.today > st.next_due) as stage_late,
  greatest(t.today - st.next_due, 0) as days_late,
  lc.received_on - lc.sent_on as turnaround_days,
  na.next_appointment_at,
  (lc.cancelled_at is null and lc.received_on is null
   and na.next_appointment_at is not null
   and (na.next_appointment_at at time zone c.timezone)::date <= t.today + 3) as at_risk
from public.lab_cases lc
join public.labs l       on l.id = lc.lab_id
join public.patients p   on p.id = lc.patient_id
join public.clinics c    on c.id = lc.clinic_id
left join public.lab_items li on li.id = lc.item_id
left join public.clinic_members doc
  on doc.clinic_id = lc.clinic_id and doc.user_id = lc.doctor_id
cross join lateral (select (now() at time zone c.timezone)::date as today) t
cross join lateral (
  select case
    when lc.cancelled_at is not null or lc.fitted_on is not null then null
    when lc.received_on is not null       then lc.received_on
    when lc.tryin_done_on is not null     then lc.expected_on
    when lc.tryin_received_on is not null then lc.tryin_received_on
    when lc.needs_tryin                   then lc.tryin_expected_on
    else lc.expected_on
  end as next_due
) st
left join lateral (
  select min(a.starts_at) as next_appointment_at
  from public.appointments a
  where a.patient_id = lc.patient_id and a.status = 'booked' and a.starts_at > now()
) na on true
where not exists (
  select 1 from public.patients ap where ap.id = lc.patient_id and ap.archived_at is not null);

grant select on public.lab_case_status to authenticated;
revoke all on public.lab_case_status from anon;
