-- =====================================================================
-- Dental Clinic System — migration 0017: doctors
-- Requires: 0001–0016
--
--   * profiles: specialty, phone, registration number, working days/hours
--   * payouts: what each doctor was actually paid, recorded as a salaries
--     expense in the same transaction so finance stays truthful
--   * doctor_overview(): work done, commission earned, paid, and balance
--
-- Owner only. appointments.doctor_id already exists (0001), so per-doctor
-- scheduling needs no schema change.
-- =====================================================================

alter table public.clinic_members
  add column specialty       text,
  add column phone           text,
  add column registration_no text,                      -- printed on prescriptions
  add column work_days       smallint[] not null default '{}',  -- 0 = Sunday … 6 = Saturday
  add column works_from      time,
  add column works_to        time,
  add constraint clinic_members_hours_valid
    check (works_from is null or works_to is null or works_to > works_from);

grant update (specialty, phone, registration_no, work_days, works_from, works_to)
  on public.clinic_members to authenticated;

-- ---------------------------------------------------------------------
-- Payouts
-- ---------------------------------------------------------------------
create table public.doctor_payouts (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id),
  user_id     uuid not null,
  paid_on     date not null,
  period_from date,
  period_to   date,
  amount      numeric(12,2) not null check (amount > 0),
  method      public.payment_method not null,
  note        text,
  expense_id  uuid references public.expenses(id),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  foreign key (clinic_id, user_id) references public.clinic_members (clinic_id, user_id),
  check (period_to is null or period_from is null or period_to >= period_from)
);
create index doctor_payouts_idx on public.doctor_payouts (clinic_id, user_id, paid_on);

create trigger doctor_payouts_append_only
  before update or delete on public.doctor_payouts
  for each row execute function public.forbid_mutation();

-- Paying a doctor is money leaving the clinic: the payout and its salaries
-- expense are written together, so the finance report can never miss it.
create or replace function public.record_doctor_payout(
  p_clinic uuid,
  p_user   uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_paid_on date default null,
  p_period_from date default null,
  p_period_to   date default null,
  p_note   text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_name    text;
  v_on      date;
  v_expense uuid;
  v_id      uuid;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can record doctor payouts' using errcode = '42501';
  end if;
  select display_name into v_name from public.clinic_members
  where clinic_id = p_clinic and user_id = p_user;
  if not found then raise exception 'Doctor not found in this clinic'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  v_on := coalesce(p_paid_on, public.clinic_today(p_clinic));
  if v_on > public.clinic_today(p_clinic) then raise exception 'Cannot record a payout in the future'; end if;

  insert into public.expenses (clinic_id, spent_on, category, amount, method, paid_to, note)
  values (p_clinic, v_on, 'salaries', p_amount, p_method, v_name,
          nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_expense;

  insert into public.doctor_payouts
    (clinic_id, user_id, paid_on, period_from, period_to, amount, method, note, expense_id)
  values
    (p_clinic, p_user, v_on, p_period_from, p_period_to, p_amount, p_method,
     nullif(trim(coalesce(p_note, '')), ''), v_expense)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- One row per doctor: profile, work done in the period, and money
-- ---------------------------------------------------------------------
create or replace function public.doctor_overview(p_clinic uuid, p_from date, p_to date)
returns table (
  user_id         uuid,
  display_name    text,
  role            public.member_role,
  active          boolean,
  specialty       text,
  phone           text,
  registration_no text,
  work_days       smallint[],
  works_from      time,
  works_to        time,
  percent         numeric,
  sessions        bigint,
  patients        bigint,
  work_value      numeric,
  collected       numeric,
  earned          numeric,
  paid_in_period  numeric,
  paid_all_time   numeric,
  appointments    bigint
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_tz text;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see doctor figures' using errcode = '42501';
  end if;
  select timezone into v_tz from public.clinics where id = p_clinic;

  return query
  with s as (   -- sessions performed in the period
    select se.performed_by as uid, count(*) as n, count(distinct se.patient_id) as pts
    from public.sessions se
    where se.clinic_id = p_clinic
      and (se.performed_at at time zone v_tz)::date between p_from and p_to
    group by se.performed_by
  ), w as (     -- value of the treatment they marked done
    select se.performed_by as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions se on se.id = i.done_in_session_id
    where se.clinic_id = p_clinic and i.status = 'done'
      and (se.performed_at at time zone v_tz)::date between p_from and p_to
    group by se.performed_by
  ), a as (     -- appointments assigned to them
    select ap.doctor_id as uid, count(*) as n
    from public.appointments ap
    where ap.clinic_id = p_clinic and ap.doctor_id is not null
      and ap.status not in ('cancelled', 'no_show')
      and (ap.starts_at at time zone v_tz)::date between p_from and p_to
    group by ap.doctor_id
  ), pay as (   -- payouts
    select dp.user_id as uid,
           sum(dp.amount) filter (where dp.paid_on between p_from and p_to) as in_period,
           sum(dp.amount) as all_time
    from public.doctor_payouts dp
    where dp.clinic_id = p_clinic
    group by dp.user_id
  ), e as (     -- commission from the shared calculation, same basis as Finance
    select de.user_id as uid, de.earned
    from public.doctor_earnings(p_clinic, p_from, p_to) de
  )
  select m.user_id, m.display_name, m.role, m.active,
         m.specialty, m.phone, m.registration_no, m.work_days, m.works_from, m.works_to,
         m.commission_percent,
         coalesce(s.n, 0), coalesce(s.pts, 0),
         round(coalesce(w.value, 0), 2),
         round(coalesce((select sum(p.amount) from public.payments p
                         join public.sessions se2 on se2.patient_id = p.patient_id
                         where p.clinic_id = p_clinic and se2.performed_by = m.user_id
                           and (p.received_at at time zone v_tz)::date between p_from and p_to), 0), 2),
         round(coalesce(e.earned, 0), 2),
         round(coalesce(pay.in_period, 0), 2),
         round(coalesce(pay.all_time, 0), 2),
         coalesce(a.n, 0)
  from public.clinic_members m
  left join s   on s.uid   = m.user_id
  left join w   on w.uid   = m.user_id
  left join a   on a.uid   = m.user_id
  left join pay on pay.uid = m.user_id
  left join e   on e.uid   = m.user_id
  where m.clinic_id = p_clinic and m.role in ('owner', 'doctor')
  order by m.active desc, m.display_name;
end;
$$;

alter table public.doctor_payouts enable row level security;
create policy doctor_payouts_select on public.doctor_payouts for select to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]));

revoke insert, update, delete on public.doctor_payouts from authenticated;
grant select on public.doctor_payouts to authenticated;
grant execute on function
  public.doctor_overview(uuid, date, date),
  public.record_doctor_payout(uuid, uuid, numeric, public.payment_method, date, date, date, text)
to authenticated;
