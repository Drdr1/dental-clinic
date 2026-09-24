-- =====================================================================
-- Dental Clinic System — migration 0018: commission on total clinic income
-- Requires: 0001–0017
--
-- A third basis: each doctor takes their percentage of ALL money the clinic
-- collected in the period, regardless of who performed the treatment.
--   work          → value of the treatment they performed
--   collection    → money collected on the plans they worked on
--   clinic_income → their percentage of everything the clinic collected
-- =====================================================================

alter table public.clinics drop constraint if exists clinics_commission_basis_check;
alter table public.clinics
  add constraint clinics_commission_basis_check
  check (commission_basis in ('work', 'collection', 'clinic_income'));

create or replace function public.doctor_earnings(p_clinic uuid, p_from date, p_to date)
returns table (
  user_id      uuid,
  display_name text,
  percent      numeric,
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

  -- Everything the clinic collected in the period (reversals already netted).
  select coalesce(sum(p.amount), 0) into v_income
  from public.payments p
  where p.clinic_id = p_clinic
    and (p.received_at at time zone v_tz)::date between p_from and p_to;

  return query
  with work as (
    select s.performed_by as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions s on s.id = i.done_in_session_id
    where s.clinic_id = p_clinic
      and (s.performed_at at time zone v_tz)::date between p_from and p_to
      and i.status = 'done'
    group by s.performed_by
  ), plan_share as (
    select i.plan_id, s.performed_by as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions s on s.id = i.done_in_session_id
    where s.clinic_id = p_clinic and i.status = 'done'
    group by i.plan_id, s.performed_by
  ), paid as (
    select p.treatment_plan_id as plan_id, sum(p.amount) as amount
    from public.payments p
    where p.clinic_id = p_clinic and p.treatment_plan_id is not null
      and (p.received_at at time zone v_tz)::date between p_from and p_to
    group by p.treatment_plan_id
  ), plan_total as (
    select plan_id, sum(value) as total from plan_share group by plan_id
  ), collection as (
    select ps.uid, sum(pd.amount * ps.value / pt.total) as value
    from plan_share ps
    join plan_total pt on pt.plan_id = ps.plan_id and pt.total > 0
    join paid pd on pd.plan_id = ps.plan_id
    group by ps.uid
  )
  select m.user_id, m.display_name, m.commission_percent,
         round(coalesce(b.value, 0), 2),
         round(coalesce(b.value, 0) * m.commission_percent / 100, 2),
         v_basis
  from public.clinic_members m
  left join (
    select uid, value from work       where v_basis = 'work'
    union all
    select uid, value from collection where v_basis = 'collection'
  ) b on b.uid = m.user_id
  where m.clinic_id = p_clinic and m.role in ('owner', 'doctor') and m.commission_percent > 0
    and v_basis <> 'clinic_income'

  union all

  -- clinic_income: every doctor's base is the clinic's whole collection.
  select m.user_id, m.display_name, m.commission_percent,
         round(v_income, 2),
         round(v_income * m.commission_percent / 100, 2),
         v_basis
  from public.clinic_members m
  where m.clinic_id = p_clinic and m.role in ('owner', 'doctor') and m.commission_percent > 0
    and v_basis = 'clinic_income'
  order by 5 desc;
end;
$$;

grant execute on function public.doctor_earnings(uuid, date, date) to authenticated;
