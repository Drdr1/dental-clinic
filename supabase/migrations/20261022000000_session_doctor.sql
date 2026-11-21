-- =====================================================================
-- Dental Clinic System — migration 0034: a visit belongs to the doctor
-- who performed it, not to whoever typed it in.
-- Requires: 0001–0033
--
-- sessions.performed_by has always been auth.uid(): the account that
-- saved the record. Reception saves most of them, so in practice the
-- clinic's work was being credited to the receptionist — 19 of the
-- first 28 visits — and every doctor's figure read zero while the day's
-- cash came in normally.
--
-- A visit now carries the treating doctor explicitly. performed_by
-- stays as it is: it is the audit trail of who entered the record, and
-- that is worth keeping separate from who did the work.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------
alter table public.sessions
  add column if not exists doctor_id uuid;

do $$ begin
  alter table public.sessions
    add constraint sessions_doctor_fk
    foreign key (clinic_id, doctor_id) references public.clinic_members (clinic_id, user_id);
exception when duplicate_object then null; end $$;

create index if not exists sessions_doctor_idx on public.sessions (clinic_id, doctor_id);

-- Existing visits: the person who saved it if they are a doctor or the
-- owner, otherwise the patient's own doctor. Anything left null stays
-- null rather than being guessed.
update public.sessions s
set doctor_id = coalesce(
      (select m.user_id from public.clinic_members m
        where m.clinic_id = s.clinic_id and m.user_id = s.performed_by
          and m.role in ('owner', 'doctor')),
      (select p.primary_doctor_id from public.patients p where p.id = s.patient_id))
where s.doctor_id is null;

-- ---------------------------------------------------------------------
-- 2. Recording a visit names the doctor
-- ---------------------------------------------------------------------
create or replace function public.record_session(
  p_patient_id        uuid,
  p_notes             text,
  p_is_recall_visit   boolean,
  p_treatment_plan_id uuid    default null,
  p_done_item_ids     uuid[]  default '{}',
  p_override_reason   text    default null,
  p_doctor_id         uuid    default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic  uuid;
  v_id      uuid;
  v_marked  int;
  v_doctor  uuid;
  v_wanted  int := coalesce(array_length(p_done_item_ids, 1), 0);
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if not found then raise exception 'Patient not found'; end if;
  if not public.is_member(v_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;

  if p_treatment_plan_id is not null and not exists (
    select 1 from public.treatment_plans
    where id = p_treatment_plan_id and patient_id = p_patient_id
  ) then
    raise exception 'Treatment plan does not belong to this patient';
  end if;
  if v_wanted > 0 and p_treatment_plan_id is null then
    raise exception 'Items can only be marked done within a treatment plan';
  end if;

  -- Whose work this is: what the form says, else the caller if they are a
  -- doctor, else the patient's own doctor.
  v_doctor := p_doctor_id;
  if v_doctor is null then
    select m.user_id into v_doctor from public.clinic_members m
    where m.clinic_id = v_clinic and m.user_id = auth.uid() and m.role in ('owner', 'doctor');
  end if;
  if v_doctor is null then
    select p.primary_doctor_id into v_doctor from public.patients p where p.id = p_patient_id;
  end if;
  if v_doctor is not null and not exists (
    select 1 from public.clinic_members m
    where m.clinic_id = v_clinic and m.user_id = v_doctor and m.role in ('owner', 'doctor')
  ) then
    raise exception 'That doctor is not on this clinic''s team';
  end if;

  insert into public.sessions
    (clinic_id, patient_id, treatment_plan_id, doctor_id, notes, is_recall_visit, lock_override, override_reason)
  values
    (v_clinic, p_patient_id, p_treatment_plan_id, v_doctor, nullif(trim(p_notes), ''), coalesce(p_is_recall_visit, false),
     length(trim(coalesce(p_override_reason, ''))) > 0, nullif(trim(p_override_reason), ''))
  returning id into v_id;

  if v_wanted > 0 then
    update public.treatment_plan_items
    set status = 'done', done_in_session_id = v_id
    where id = any (p_done_item_ids)
      and plan_id = p_treatment_plan_id
      and status = 'planned';
    get diagnostics v_marked = row_count;
    if v_marked <> v_wanted then
      raise exception 'Some items are no longer open on this plan; refresh and try again';
    end if;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.record_session(uuid, text, boolean, uuid, uuid[], text, uuid) from public, anon;
grant  execute on function public.record_session(uuid, text, boolean, uuid, uuid[], text, uuid) to authenticated;

-- The six-argument version would still be chosen for old calls and would
-- keep crediting the typist, so it goes.
drop function if exists public.record_session(uuid, text, boolean, uuid, uuid[], text);

-- Lets the owner correct who a visit belongs to.
grant update (doctor_id) on public.sessions to authenticated;

-- ---------------------------------------------------------------------
-- 3. Earnings and the doctors page read the treating doctor
-- ---------------------------------------------------------------------
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
  with work as (          -- value of what each doctor finished in the period
    select coalesce(s.doctor_id, s.performed_by) as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions s on s.id = i.done_in_session_id
    where s.clinic_id = p_clinic
      and (s.performed_at at time zone v_tz)::date between p_from and p_to
      and i.status = 'done'
    group by 1
  ), plan_share as (      -- every doctor's finished value on each plan, all time
    select i.plan_id, coalesce(s.doctor_id, s.performed_by) as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions s on s.id = i.done_in_session_id
    where s.clinic_id = p_clinic and i.status = 'done'
    group by i.plan_id, 2
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
    select pat.primary_doctor_id as uid, sum(p.amount) as value
    from public.payments p
    join public.patients pat on pat.id = p.patient_id
    where p.clinic_id = p_clinic and p.treatment_plan_id is null
      and pat.primary_doctor_id is not null
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
  ), lab as (             -- his own lab bills, in the month they are charged to
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
  where m.clinic_id = p_clinic
    and m.role in ('owner', 'doctor')
    and m.commission_percent > 0
  order by 7 desc;
end;
$$;

grant execute on function public.doctor_earnings(uuid, date, date) to authenticated;

-- Session and patient counts follow the treating doctor as well.
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
  lab_cost        numeric,
  base_amount     numeric,
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
         round(coalesce(pay.all_time, 0), 2),
         coalesce(a.n, 0)
  from public.clinic_members m
  left join s    on s.uid    = m.user_id
  left join w    on w.uid    = m.user_id
  left join a    on a.uid    = m.user_id
  left join pay  on pay.uid  = m.user_id
  left join earn e on e.user_id = m.user_id
  where m.clinic_id = p_clinic and m.role in ('owner', 'doctor')
  order by m.active desc, m.display_name;
end;
$$;

grant execute on function public.doctor_overview(uuid, date, date) to authenticated;
