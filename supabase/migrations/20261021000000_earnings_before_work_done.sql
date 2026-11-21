-- =====================================================================
-- Dental Clinic System — migration 0033: money counts for a doctor even
-- before the work is ticked off.
-- Requires: 0001–0032
--
-- A payment on a treatment plan was split between the doctors by the
-- value each had finished on it. Sound, but it has a blind spot the
-- clinic walked straight into: before anything on the plan is marked
-- done there is nothing to split by, so the money counted for nobody
-- and every doctor's figure read zero while cash was coming in daily.
--
-- The plan's money now falls back to the patient's own doctor until the
-- first item is finished, and from then on the original split takes
-- over — so the figure is right on the day and still settles case by
-- case once the work is recorded.
--
-- The lab deduction follows the month the case is charged to (0032).
-- =====================================================================

drop function if exists public.doctor_earnings(uuid, date, date);

create function public.doctor_earnings(p_clinic uuid, p_from date, p_to date)
returns table (
  user_id      uuid,
  display_name text,
  percent      numeric,
  collected    numeric,   -- collected in the period on this doctor's work
  lab_cost     numeric,   -- his lab cases that came back in the period
  base_amount  numeric,   -- what the percentage is taken on
  earned       numeric,
  basis        text
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_tz     text;
  v_basis  text;
  v_income numeric;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see doctor earnings' using errcode = '42501';
  end if;
  select timezone, commission_basis into v_tz, v_basis from public.clinics where id = p_clinic;

  select coalesce(sum(p.amount), 0) into v_income
  from public.payments p
  where p.clinic_id = p_clinic
    and (p.received_at at time zone v_tz)::date between p_from and p_to;

  return query
  with work as (          -- value of what each doctor finished in the period
    select s.performed_by as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions s on s.id = i.done_in_session_id
    where s.clinic_id = p_clinic
      and (s.performed_at at time zone v_tz)::date between p_from and p_to
      and i.status = 'done'
    group by s.performed_by
  ), plan_share as (      -- every doctor's finished value on each plan, all time
    select i.plan_id, s.performed_by as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions s on s.id = i.done_in_session_id
    where s.clinic_id = p_clinic and i.status = 'done'
    group by i.plan_id, s.performed_by
  ), plan_total as (
    select plan_id, sum(value) as total from plan_share group by plan_id
  ), paid as (            -- collected per plan in the period
    select p.treatment_plan_id as plan_id, sum(p.amount) as amount
    from public.payments p
    where p.clinic_id = p_clinic and p.treatment_plan_id is not null
      and (p.received_at at time zone v_tz)::date between p_from and p_to
    group by p.treatment_plan_id
  ), plan_money as (      -- split each plan's money by who did the work
    select ps.uid, sum(pd.amount * ps.value / pt.total) as value
    from plan_share ps
    join plan_total pt on pt.plan_id = ps.plan_id and pt.total > 0
    join paid pd on pd.plan_id = ps.plan_id
    group by ps.uid
  ), unworked_money as (  -- a plan with nothing finished yet: the patient's own doctor
    select pat.primary_doctor_id as uid, sum(pd.amount) as value
    from paid pd
    join public.treatment_plans tp on tp.id = pd.plan_id
    join public.patients pat on pat.id = tp.patient_id
    left join plan_total pt on pt.plan_id = pd.plan_id
    where coalesce(pt.total, 0) = 0
      and pat.primary_doctor_id is not null
    group by pat.primary_doctor_id
  ), direct_money as (    -- payments not tied to a plan go to the patient's own doctor
    select pt.primary_doctor_id as uid, sum(p.amount) as value
    from public.payments p
    join public.patients pt on pt.id = p.patient_id
    where p.clinic_id = p_clinic and p.treatment_plan_id is null
      and pt.primary_doctor_id is not null
      and (p.received_at at time zone v_tz)::date between p_from and p_to
    group by pt.primary_doctor_id
  ), collection as (
    select uid, sum(value) as value
    from (
      select uid, value from plan_money
      union all select uid, value from unworked_money
      union all select uid, value from direct_money
    ) x
    group by uid
  ), lab as (             -- his own lab bills, counted when the work came back
    select lc.doctor_id as uid, sum(lc.lab_fee) as value
    from public.lab_cases lc
    where lc.clinic_id = p_clinic
      and lc.doctor_id is not null
      and lc.cancelled_at is null
      and coalesce(lc.lab_fee, 0) > 0
      and coalesce(lc.billing_on, lc.received_on) between p_from and p_to
    group by lc.doctor_id
  )
  select m.user_id,
         m.display_name,
         m.commission_percent,
         round(coalesce(c.value, 0), 2),
         round(coalesce(l.value, 0), 2),
         round(b.base, 2),
         round(greatest(b.base, 0) * m.commission_percent / 100, 2),
         v_basis
  from public.clinic_members m
  left join collection c on c.uid = m.user_id
  left join lab        l on l.uid = m.user_id
  left join work       w on w.uid = m.user_id
  cross join lateral (
    select case v_basis
             when 'work'               then coalesce(w.value, 0)
             when 'collection'          then coalesce(c.value, 0)
             when 'clinic_income'       then v_income
             else coalesce(c.value, 0) - coalesce(l.value, 0)
           end as base
  ) b
  where m.clinic_id = p_clinic
    and m.role in ('owner', 'doctor')
    and m.commission_percent > 0
  order by 7 desc;
end;
$$;

grant execute on function public.doctor_earnings(uuid, date, date) to authenticated;
