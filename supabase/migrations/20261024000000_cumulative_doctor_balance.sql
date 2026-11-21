-- =====================================================================
-- Dental Clinic System — migration 0036: what the clinic actually owes
-- a doctor.
-- Requires: 0001–0035
--
-- The balance column subtracted every payout ever made from the
-- selected month's earnings, which only agreed with reality while no
-- payout existed. Pay a doctor October's 102,602 on the 1st of November
-- and November's page would report him 99,302 in debt to the clinic.
--
-- The balance is now cumulative on both sides: everything earned since
-- the clinic started, less everything paid. The month's own figures
-- stay as they are, beside it.
-- =====================================================================

drop function if exists public.doctor_overview(uuid, date, date);

create function public.doctor_overview(p_clinic uuid, p_from date, p_to date)
returns table (
  user_id          uuid,
  display_name     text,
  role             public.member_role,
  active           boolean,
  specialty        text,
  phone            text,
  registration_no  text,
  work_days        smallint[],
  works_from       time,
  works_to         time,
  percent          numeric,
  sessions         bigint,
  patients         bigint,
  work_value       numeric,
  collected        numeric,
  lab_cost         numeric,
  base_amount      numeric,
  earned           numeric,   -- the selected period
  paid_in_period   numeric,
  earned_all_time  numeric,   -- since the clinic started
  paid_all_time    numeric,
  appointments     bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_tz    text;
  v_today date;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see doctor figures' using errcode = '42501';
  end if;
  select timezone into v_tz from public.clinics where id = p_clinic;
  v_today := public.clinic_today(p_clinic);

  return query
  with s as (
    select coalesce(se.doctor_id, se.performed_by) as uid,
           count(*) as n, count(distinct se.patient_id) as pts
    from public.sessions se
    where se.clinic_id = p_clinic
      and (se.performed_at at time zone v_tz)::date between p_from and p_to
    group by 1
  ), w as (
    select coalesce(se.doctor_id, se.performed_by) as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions se on se.id = i.done_in_session_id
    where se.clinic_id = p_clinic and i.status = 'done'
      and (se.performed_at at time zone v_tz)::date between p_from and p_to
    group by 1
  ), a as (
    select ap.doctor_id as uid, count(*) as n
    from public.appointments ap
    where ap.clinic_id = p_clinic and ap.doctor_id is not null
      and ap.status not in ('cancelled', 'no_show')
      and (ap.starts_at at time zone v_tz)::date between p_from and p_to
    group by ap.doctor_id
  ), pay as (
    select dp.user_id as uid,
           sum(dp.amount) filter (where dp.paid_on between p_from and p_to) as in_period,
           sum(dp.amount) as all_time
    from public.doctor_payouts dp
    where dp.clinic_id = p_clinic
    group by dp.user_id
  ), earn as (
    select * from public.doctor_earnings(p_clinic, p_from, p_to)
  ), earn_all as (
    -- Everything ever earned. The start date is simply earlier than any
    -- clinic could have records for.
    select * from public.doctor_earnings(p_clinic, date '2000-01-01', v_today)
  )
  select m.user_id, m.display_name, m.role, m.active,
         m.specialty, m.phone, m.registration_no, m.work_days, m.works_from, m.works_to,
         m.commission_percent,
         coalesce(s.n, 0), coalesce(s.pts, 0),
         round(coalesce(w.value, 0), 2),
         round(coalesce(e.collected, 0), 2),
         round(coalesce(e.lab_cost, 0), 2),
         round(coalesce(e.base_amount, 0), 2),
         round(coalesce(e.earned, 0), 2),
         round(coalesce(pay.in_period, 0), 2),
         round(coalesce(ea.earned, 0), 2),
         round(coalesce(pay.all_time, 0), 2),
         coalesce(a.n, 0)
  from public.clinic_members m
  left join s      on s.uid   = m.user_id
  left join w      on w.uid   = m.user_id
  left join a      on a.uid   = m.user_id
  left join pay    on pay.uid = m.user_id
  left join earn    e  on e.user_id  = m.user_id
  left join earn_all ea on ea.user_id = m.user_id
  where m.clinic_id = p_clinic and m.role in ('owner', 'doctor')
  order by m.active desc, m.display_name;
end;
$$;

grant execute on function public.doctor_overview(uuid, date, date) to authenticated;
