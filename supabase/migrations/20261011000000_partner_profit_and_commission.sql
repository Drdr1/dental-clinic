-- =====================================================================
-- Dental Clinic System — migration 0023: how the money is actually split
-- Requires: 0001–0022
--
-- The clinic's rules, as the owners run them:
--
--   Doctor's commission
--     base    = money COLLECTED in the month on the work he did
--               (an unpaid instalment earns him nothing)
--               minus the lab bills for his own cases
--     earned  = base × his percentage
--     Materials are the clinic's cost, never the doctor's.
--
--   Lab bills land in the month the case CAME BACK from the lab, which
--   is when the lab invoices and gets settled — not the month it was sent.
--
--   Monthly profit
--     income − doctors − materials − rent − admin − lab − salaries
--     = net profit, split between the partners by their shares.
--
--   Admin, rent and salaries are entered by hand each month.
--
-- Work that passes between doctors (a patient referred to the surgeon,
-- say) is settled case by case: every finished item belongs to whoever
-- performed it, and a payment on the plan is divided between them in
-- proportion to the value each one finished.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Lab cases belong to a doctor
-- ---------------------------------------------------------------------
alter table public.lab_cases
  add column if not exists doctor_id uuid;

do $$ begin
  alter table public.lab_cases
    add constraint lab_cases_doctor_fk
    foreign key (clinic_id, doctor_id) references public.clinic_members (clinic_id, user_id);
exception when duplicate_object then null; end $$;

create index if not exists lab_cases_doctor_idx on public.lab_cases (clinic_id, doctor_id);

-- Existing cases: the doctor who finished the item, else the patient's own doctor.
update public.lab_cases lc
set doctor_id = coalesce(
      (select se.performed_by
         from public.treatment_plan_items i
         join public.sessions se on se.id = i.done_in_session_id
        where i.id = lc.plan_item_id),
      (select p.primary_doctor_id from public.patients p where p.id = lc.patient_id))
where lc.doctor_id is null;

-- A doctor who has since left the clinic would break the FK; drop those.
update public.lab_cases lc
set doctor_id = null
where lc.doctor_id is not null
  and not exists (
    select 1 from public.clinic_members m
    where m.clinic_id = lc.clinic_id and m.user_id = lc.doctor_id);

-- ---------------------------------------------------------------------
-- 2. The lab expense falls in the month the work came back
-- ---------------------------------------------------------------------
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
  -- Still out at the lab: hold it on the send date until it comes back.
  v_on := coalesce(new.received_on, new.sent_on);

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
  elsif new.lab_fee      is distinct from old.lab_fee
     or new.sent_on      is distinct from old.sent_on
     or new.received_on  is distinct from old.received_on then
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

-- Move the lab expenses that are already back to their received month.
update public.expenses e
set spent_on = lc.received_on
from public.lab_cases lc
where e.lab_case_id = lc.id
  and lc.received_on is not null
  and e.voided_at is null
  and e.spent_on <> lc.received_on;

revoke execute on function public.sync_lab_expense() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Doctor payouts stop hiding inside 'salaries'
-- ---------------------------------------------------------------------
update public.expenses e
set category = 'doctors'
where e.id in (select expense_id from public.doctor_payouts where expense_id is not null)
  and e.category = 'salaries';

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
  values (p_clinic, v_on, 'doctors', p_amount, p_method, v_name,
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
-- 4. The commission basis the clinic actually uses
-- ---------------------------------------------------------------------
alter table public.clinics drop constraint if exists clinics_commission_basis_check;
alter table public.clinics
  add constraint clinics_commission_basis_check
  check (commission_basis in ('work', 'collection', 'collection_net_lab', 'clinic_income'));

-- 'clinic_income' (a cut of everything the clinic takes) was a stand-in;
-- the real rule nets the doctor's own lab bills off his own collections.
update public.clinics set commission_basis = 'collection_net_lab'
where commission_basis = 'clinic_income';

alter table public.clinics
  alter column commission_basis set default 'collection_net_lab';

-- ---------------------------------------------------------------------
-- 5. Earnings, with the lab deduction shown
-- ---------------------------------------------------------------------
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
    from (select uid, value from plan_money union all select uid, value from direct_money) x
    group by uid
  ), lab as (             -- his own lab bills, counted when the work came back
    select lc.doctor_id as uid, sum(lc.lab_fee) as value
    from public.lab_cases lc
    where lc.clinic_id = p_clinic
      and lc.doctor_id is not null
      and lc.cancelled_at is null
      and coalesce(lc.lab_fee, 0) > 0
      and lc.received_on between p_from and p_to
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

-- ---------------------------------------------------------------------
-- 6. Partners and the profit split
-- ---------------------------------------------------------------------
create table if not exists public.partners (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  name          text not null,
  user_id       uuid,                       -- optional: a partner who also works here
  share_percent numeric(5,2) not null default 0
                check (share_percent >= 0 and share_percent <= 100),
  active        boolean not null default true,
  note          text,
  created_at    timestamptz not null default now(),
  unique (clinic_id, name)
);

alter table public.partners enable row level security;

drop policy if exists partners_owner_read  on public.partners;
drop policy if exists partners_owner_write on public.partners;

create policy partners_owner_read on public.partners
  for select using (public.has_role(clinic_id, array['owner']::public.member_role[]));
create policy partners_owner_write on public.partners
  for all using (public.has_role(clinic_id, array['owner']::public.member_role[]))
       with check (public.has_role(clinic_id, array['owner']::public.member_role[]));

grant select, insert, update, delete on public.partners to authenticated;

-- The month's profit statement, the way the owners read it.
create or replace function public.clinic_profit(p_clinic uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_tz         text;
  v_income     numeric;
  v_commission numeric;
  v_expenses   numeric;
  v_by_cat     jsonb;
  v_paid_out   numeric;
  v_net        numeric;
  v_pct        numeric;
  v_partners   jsonb;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see the profit statement' using errcode = '42501';
  end if;
  select timezone into v_tz from public.clinics where id = p_clinic;

  select coalesce(sum(p.amount), 0) into v_income
  from public.payments p
  where p.clinic_id = p_clinic
    and (p.received_at at time zone v_tz)::date between p_from and p_to;

  -- What the doctors earned on this month's work, paid or not yet.
  select coalesce(sum(e.earned), 0) into v_commission
  from public.doctor_earnings(p_clinic, p_from, p_to) e;

  -- Every other cost. 'doctors' is left out: that line is the commission
  -- above, and counting the payout as well would charge it twice.
  select coalesce(sum(x.amount), 0),
         coalesce(jsonb_object_agg(x.category, x.total) filter (where x.category is not null), '{}'::jsonb)
  into v_expenses, v_by_cat
  from (
    select e.category::text as category, sum(e.amount) as total, sum(e.amount) as amount
    from public.expenses e
    where e.clinic_id = p_clinic and e.voided_at is null
      and e.spent_on between p_from and p_to
      and e.category <> 'doctors'
    group by e.category
  ) x;

  select coalesce(sum(e.amount), 0) into v_paid_out
  from public.expenses e
  where e.clinic_id = p_clinic and e.voided_at is null
    and e.spent_on between p_from and p_to
    and e.category = 'doctors';

  v_net := v_income - v_commission - v_expenses;

  select coalesce(sum(share_percent), 0) into v_pct
  from public.partners where clinic_id = p_clinic and active;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pr.id,
           'name', pr.name,
           'percent', pr.share_percent,
           'amount', round(v_net * pr.share_percent / 100, 2)
         ) order by pr.share_percent desc, pr.name), '[]'::jsonb)
  into v_partners
  from public.partners pr
  where pr.clinic_id = p_clinic and pr.active;

  return jsonb_build_object(
    'income',               round(v_income, 2),
    'doctor_commission',    round(v_commission, 2),
    'commission_paid',      round(v_paid_out, 2),
    'commission_due',       round(v_commission - v_paid_out, 2),
    'expenses',             round(v_expenses, 2),
    'expenses_by_category', v_by_cat,
    'net_profit',           round(v_net, 2),
    'partner_percent_total', v_pct,
    'partners',             v_partners
  );
end;
$$;

grant execute on function public.clinic_profit(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 7. The doctors page reads the same numbers
-- ---------------------------------------------------------------------
drop function if exists public.doctor_overview(uuid, date, date);

create function public.doctor_overview(p_clinic uuid, p_from date, p_to date)
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
    select se.performed_by as uid, count(*) as n, count(distinct se.patient_id) as pts
    from public.sessions se
    where se.clinic_id = p_clinic
      and (se.performed_at at time zone v_tz)::date between p_from and p_to
    group by se.performed_by
  ), w as (
    select se.performed_by as uid, sum(i.price) as value
    from public.treatment_plan_items i
    join public.sessions se on se.id = i.done_in_session_id
    where se.clinic_id = p_clinic and i.status = 'done'
      and (se.performed_at at time zone v_tz)::date between p_from and p_to
    group by se.performed_by
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
