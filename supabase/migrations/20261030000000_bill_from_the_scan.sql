-- =====================================================================
-- Dental Clinic System — migration 0042: the lab is owed from the scan
-- Requires: 0001–0041
--
-- Nada: "المعمل بياخد فلوسه أول ما يبعت الحاجة" — the fee is owed the day
-- the scan goes out, not the day the work comes back. The system was
-- costing a case on its return, so work sent in one month and delivered
-- in the next landed in the wrong month, and work still out at the lab
-- did not appear on the invoice check at all.
--
-- From here the month is: the month stated by hand, else the month the
-- scan was sent. A case that has not come back yet is now costed like
-- any other — because the lab will bill for it either way.
--
-- Checked against the live data before shipping: every existing case
-- either carries a hand-set month or came back in the month it was sent,
-- so no past figure moves. The backfill below is therefore a no-op today
-- and exists only to keep the two in step.
--
-- A per-lab history function is added at the end for the lab profile.
-- =====================================================================

create or replace function public.sync_lab_expense()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_lab text;
  v_on  date;
begin
  select name into v_lab from public.labs where id = new.lab_id;
  -- Stated month wins; otherwise the day the scan went out, because that
  -- is when the lab starts counting.
  v_on := coalesce(new.billing_on, new.sent_on);

  if tg_op = 'INSERT' then
    if new.lab_fee is not null and new.lab_fee > 0 then
      insert into public.expenses (clinic_id, spent_on, category, amount, paid_to, note, lab_case_id)
      values (new.clinic_id, v_on, 'lab', new.lab_fee, v_lab, new.description, new.id);
    end if;
    return null;
  end if;

  -- UPDATE
  if new.cancelled_at is not null and old.cancelled_at is null then
    update public.expenses set voided_at = now(), void_reason = 'Lab work cancelled'
    where lab_case_id = new.id and voided_at is null;
  elsif new.lab_fee     is distinct from old.lab_fee
     or new.sent_on     is distinct from old.sent_on
     or new.received_on is distinct from old.received_on
     or new.billing_on  is distinct from old.billing_on then
    if coalesce(new.lab_fee, 0) > 0 then
      insert into public.expenses (clinic_id, spent_on, category, amount, paid_to, note, lab_case_id)
      values (new.clinic_id, v_on, 'lab', new.lab_fee, v_lab, new.description, new.id)
      on conflict (lab_case_id) do update
        set amount = excluded.amount, spent_on = excluded.spent_on
        where public.expenses.voided_at is null;
    else
      update public.expenses set voided_at = now(), void_reason = 'Lab fee removed'
      where lab_case_id = new.id and voided_at is null;
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function public.sync_lab_expense() from public, anon, authenticated;

-- Bring any expense already filed on the old basis into line. Lab expenses
-- carry no payment method, so the closed-day seal (0039) does not apply.
update public.expenses e
set spent_on = coalesce(lc.billing_on, lc.sent_on)
from public.lab_cases lc
where e.lab_case_id = lc.id
  and e.voided_at is null
  and lc.cancelled_at is null
  and e.spent_on is distinct from coalesce(lc.billing_on, lc.sent_on);

-- ---------------------------------------------------------------------
-- The screens follow the same month
-- ---------------------------------------------------------------------
drop view if exists public.lab_case_status;

create view public.lab_case_status with (security_invoker = true) as
select
  lc.*,
  l.name as lab_name,
  li.name as item_name,
  p.full_name,
  doc.display_name as doctor_name,
  coalesce(lc.billing_on, lc.sent_on) as billed_on,
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

-- The invoice check follows the expense, and counts units that were left
-- blank as nothing rather than dropping the whole case out of the sum.
create or replace function public.lab_invoice_check(p_clinic uuid, p_from date, p_to date)
returns table (
  lab_id       uuid,
  lab_name     text,
  cases        bigint,
  units        numeric,
  expected     numeric,
  invoiced     numeric,
  difference   numeric
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_member(p_clinic) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
  select l.id, l.name,
         count(*)::bigint,
         round(sum(coalesce(lc.units, 0)), 2),
         round(sum(coalesce(lc.lab_fee, 0)), 2),
         round(sum(coalesce(lc.invoiced_amount, 0)), 2),
         round(sum(coalesce(lc.invoiced_amount, 0)) - sum(coalesce(lc.lab_fee, 0)), 2)
  from public.lab_cases lc
  join public.labs l on l.id = lc.lab_id
  where lc.clinic_id = p_clinic
    and lc.cancelled_at is null
    and coalesce(lc.billing_on, lc.sent_on) between p_from and p_to
  group by l.id, l.name
  order by l.name;
end;
$$;

grant execute on function public.lab_invoice_check(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- One lab's history, month by month — for its profile page
-- ---------------------------------------------------------------------
create or replace function public.lab_months(p_clinic uuid, p_lab uuid)
returns table (
  month      date,
  cases      bigint,
  units      numeric,
  expected   numeric,
  invoiced   numeric,
  difference numeric,
  still_out  bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_member(p_clinic) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
  select date_trunc('month', coalesce(lc.billing_on, lc.sent_on))::date,
         count(*)::bigint,
         round(sum(coalesce(lc.units, 0)), 2),
         round(sum(coalesce(lc.lab_fee, 0)), 2),
         round(sum(coalesce(lc.invoiced_amount, 0)), 2),
         round(sum(coalesce(lc.invoiced_amount, 0)) - sum(coalesce(lc.lab_fee, 0)), 2),
         -- Sent and not back yet: what the clinic is still waiting on.
         count(*) filter (where lc.received_on is null)::bigint
  from public.lab_cases lc
  where lc.clinic_id = p_clinic
    and lc.lab_id = p_lab
    and lc.cancelled_at is null
  group by 1
  order by 1 desc;
end;
$$;

grant execute on function public.lab_months(uuid, uuid) to authenticated;
