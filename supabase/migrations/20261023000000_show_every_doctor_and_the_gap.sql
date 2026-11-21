-- =====================================================================
-- Dental Clinic System — migration 0035: show every doctor, and say out
-- loud what was not attributed to anyone.
-- Requires: 0001–0034
--
-- Two things made the doctors page impossible to reconcile against the
-- month's income:
--
--   1. Doctors on 0% were dropped from the result. Money collected on
--      their patients was still attributed to them, so it left the
--      table without leaving the clinic — in October that hid 76,868
--      of 707,375. A doctor on 0% now appears with his collections and
--      an earned figure of zero, which is the truth.
--
--   2. A patient whose "doctor" is actually a receptionist, or who has
--      none at all, produced money that belonged to nobody and was
--      silently absent. Attribution now ignores a primary doctor who
--      isn't a doctor, and the leftover is reported as a figure of its
--      own instead of being left for someone to notice.
--
-- After this: income = attributed + unattributed, every month, exactly.
-- =====================================================================

drop function if exists public.doctor_earnings(uuid, date, date);

create function public.doctor_earnings(p_clinic uuid, p_from date, p_to date)
returns table (
  user_id      uuid,
  display_name text,
  percent      numeric,
  collected    numeric,
  lab_cost     numeric,
  base_amount  numeric,
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
  with doctors as (       -- only a doctor or the owner can be credited with work
    select m.user_id from public.clinic_members m
    where m.clinic_id = p_clinic and m.role in ('owner', 'doctor')
  ), work as (
    select coalesce(s.doctor_id, s.performed_by) as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions s on s.id = i.done_in_session_id
    where s.clinic_id = p_clinic
      and (s.performed_at at time zone v_tz)::date between p_from and p_to
      and i.status = 'done'
    group by 1
  ), plan_share as (
    select i.plan_id, coalesce(s.doctor_id, s.performed_by) as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions s on s.id = i.done_in_session_id
    where s.clinic_id = p_clinic and i.status = 'done'
    group by i.plan_id, 2
  ), plan_total as (
    select plan_id, sum(value) as total from plan_share group by plan_id
  ), paid as (
    select p.treatment_plan_id as plan_id, sum(p.amount) as amount
    from public.payments p
    where p.clinic_id = p_clinic and p.treatment_plan_id is not null
      and (p.received_at at time zone v_tz)::date between p_from and p_to
    group by p.treatment_plan_id
  ), plan_money as (
    select ps.uid, sum(pd.amount * ps.value / pt.total) as value
    from plan_share ps
    join plan_total pt on pt.plan_id = ps.plan_id and pt.total > 0
    join paid pd on pd.plan_id = ps.plan_id
    group by ps.uid
  ), unworked_money as (
    select pat.primary_doctor_id as uid, sum(pd.amount) as value
    from paid pd
    join public.treatment_plans tp on tp.id = pd.plan_id
    join public.patients pat on pat.id = tp.patient_id
    join doctors d on d.user_id = pat.primary_doctor_id
    left join plan_total pt on pt.plan_id = pd.plan_id
    where coalesce(pt.total, 0) = 0
    group by pat.primary_doctor_id
  ), direct_money as (
    select pat.primary_doctor_id as uid, sum(p.amount) as value
    from public.payments p
    join public.patients pat on pat.id = p.patient_id
    join doctors d on d.user_id = pat.primary_doctor_id
    where p.clinic_id = p_clinic and p.treatment_plan_id is null
      and (p.received_at at time zone v_tz)::date between p_from and p_to
    group by pat.primary_doctor_id
  ), collection as (
    select uid, sum(value) as value
    from (
      select uid, value from plan_money
      union all select uid, value from unworked_money
      union all select uid, value from direct_money
    ) x
    group by uid
  ), lab as (
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
             when 'work'          then coalesce(w.value, 0)
             when 'collection'    then coalesce(c.value, 0)
             when 'clinic_income' then v_income
             else coalesce(c.value, 0) - coalesce(l.value, 0)
           end as base
  ) b
  -- Every doctor, whatever his percentage: a 0% doctor still collects
  -- money, and leaving him out breaks the month's arithmetic.
  where m.clinic_id = p_clinic
    and m.role in ('owner', 'doctor')
  order by 4 desc, 2;
end;
$$;

grant execute on function public.doctor_earnings(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- The month's income against what reached a doctor
-- ---------------------------------------------------------------------
create or replace function public.collection_attribution(p_clinic uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_tz         text;
  v_income     numeric;
  v_attributed numeric;
  v_orphans    bigint;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see this' using errcode = '42501';
  end if;
  select timezone into v_tz from public.clinics where id = p_clinic;

  select coalesce(sum(p.amount), 0) into v_income
  from public.payments p
  where p.clinic_id = p_clinic
    and (p.received_at at time zone v_tz)::date between p_from and p_to;

  select coalesce(sum(e.collected), 0) into v_attributed
  from public.doctor_earnings(p_clinic, p_from, p_to) e;

  -- How many payments could not be traced to a doctor at all.
  select count(*) into v_orphans
  from public.payments p
  join public.patients pat on pat.id = p.patient_id
  where p.clinic_id = p_clinic
    and (p.received_at at time zone v_tz)::date between p_from and p_to
    and not exists (
      select 1 from public.treatment_plan_items i
      join public.sessions s on s.id = i.done_in_session_id
      where i.plan_id = p.treatment_plan_id and i.status = 'done')
    and not exists (
      select 1 from public.clinic_members m
      where m.clinic_id = p_clinic and m.user_id = pat.primary_doctor_id
        and m.role in ('owner', 'doctor'));

  return jsonb_build_object(
    'income',           round(v_income, 2),
    'attributed',       round(v_attributed, 2),
    'unattributed',     round(v_income - v_attributed, 2),
    'orphan_payments',  v_orphans
  );
end;
$$;

grant execute on function public.collection_attribution(uuid, date, date) to authenticated;
