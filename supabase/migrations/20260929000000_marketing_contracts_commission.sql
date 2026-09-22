-- =====================================================================
-- Dental Clinic System — migration 0011: marketing, contracts, commission
-- Requires: 0001–0010
--
--   * patients.source: how the patient found the clinic (+ owner report)
--   * payers: companies / syndicates with a standing discount, linked to
--     patients and snapshotted on the treatment plan
--   * doctor commission: a percentage per doctor, computed either on the
--     treatment they performed or on money actually collected
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Where the patient came from
-- ---------------------------------------------------------------------
alter table public.patients
  add column source      text check (source in
    ('facebook', 'instagram', 'google', 'friend', 'signboard', 'passing', 'payer', 'returning', 'other')),
  add column source_note text;

-- ---------------------------------------------------------------------
-- 2. Contracted payers (company / syndicate discounts)
-- ---------------------------------------------------------------------
create table public.payers (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics(id) on delete cascade,
  name             text not null,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  phone            text,
  note             text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (clinic_id, name),
  unique (id, clinic_id)
);

alter table public.patients
  add column payer_id uuid,
  add foreign key (payer_id, clinic_id) references public.payers (id, clinic_id);

alter table public.treatment_plans
  add column payer_id         uuid,
  add column payer_percent    numeric(5,2),   -- snapshot of the rate used on this plan
  add foreign key (payer_id, clinic_id) references public.payers (id, clinic_id);

-- ---------------------------------------------------------------------
-- 3. Doctor commission
-- ---------------------------------------------------------------------
alter table public.clinics
  add column commission_basis text not null default 'work'
    check (commission_basis in ('work', 'collection'));

alter table public.clinic_members
  add column commission_percent numeric(5,2) not null default 0
    check (commission_percent between 0 and 100);

grant update (commission_basis) on public.clinics to authenticated;

-- What each doctor earned in a period (owner only).
--   basis 'work'       : value of the procedures they marked done in a session
--   basis 'collection' : their share of payments received, split across the
--                        plans' doctors by the value each of them performed
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
  v_tz    text;
  v_basis text;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see doctor earnings' using errcode = '42501';
  end if;
  select timezone, commission_basis into v_tz, v_basis from public.clinics where id = p_clinic;

  return query
  with work as (   -- value of treatment each member performed in the period
    select s.performed_by as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions s on s.id = i.done_in_session_id
    where s.clinic_id = p_clinic
      and (s.performed_at at time zone v_tz)::date between p_from and p_to
      and i.status = 'done'
    group by s.performed_by
  ), plan_share as ( -- how each plan's performed value splits between doctors (all time)
    select i.plan_id, s.performed_by as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions s on s.id = i.done_in_session_id
    where s.clinic_id = p_clinic and i.status = 'done'
    group by i.plan_id, s.performed_by
  ), paid as (      -- money received per plan in the period
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
    select uid, value from work where v_basis = 'work'
    union all
    select uid, value from collection where v_basis = 'collection'
  ) b on b.uid = m.user_id
  where m.clinic_id = p_clinic and m.role in ('owner', 'doctor') and m.commission_percent > 0
  order by 5 desc;
end;
$$;

-- Where patients came from, and what they brought in (owner only).
create or replace function public.patient_sources(p_clinic uuid, p_from date, p_to date)
returns table (source text, patients bigint, collected numeric)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_tz text;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see this report' using errcode = '42501';
  end if;
  select timezone into v_tz from public.clinics where id = p_clinic;

  return query
  select coalesce(p.source, 'unknown') as source,
         count(distinct p.id),
         coalesce(sum(pay.amount), 0)
  from public.patients p
  left join lateral (
    select sum(x.amount) as amount from public.payments x
    where x.patient_id = p.id and (x.received_at at time zone v_tz)::date between p_from and p_to
  ) pay on true
  where p.clinic_id = p_clinic
    and (p.created_at at time zone v_tz)::date between p_from and p_to
  group by 1
  order by 3 desc, 2 desc;
end;
$$;

alter table public.payers enable row level security;
create policy payers_select on public.payers for select to authenticated using (public.is_member(clinic_id));
create policy payers_write on public.payers for all to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]))
  with check (public.has_role(clinic_id, array['owner']::public.member_role[]));

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;
grant execute on function
  public.doctor_earnings(uuid, date, date),
  public.patient_sources(uuid, date, date)
to authenticated;
grant execute on function public.get_form_by_token(text), public.submit_form(text, jsonb, text, text) to anon;
