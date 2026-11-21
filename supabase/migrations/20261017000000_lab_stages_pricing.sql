-- =====================================================================
-- Dental Clinic System — migration 0029: lab work in three stages,
-- and what it costs before the invoice arrives.
-- Requires: 0001–0028
--
-- How the clinic actually works with the lab:
--
--   1. Scan / impression   the lab collects the scan or the impression
--   2. Try-in              the lab sends a trial; the patient tries it
--   3. Delivery            once the try-in is approved, the final work
--                          comes back and is fitted
--
-- Each stage has its own due date. Two days after the scan the try-in
-- is expected: if it hasn't arrived, chase the lab; if it has, call the
-- patient in. Two days after the try-in, the delivery is expected.
-- The wait is one setting (lab_stage_days), not a number in the code.
--
-- Pricing: units × the price of that kind of work. The case is costed
-- the day it is opened, so when the lab's invoice comes at the end of
-- the month there is already a figure to check it against.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The price list
-- ---------------------------------------------------------------------
create table if not exists public.lab_items (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  lab_id     uuid,                       -- null: the price applies to every lab
  name       text not null,
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, name),
  foreign key (lab_id, clinic_id) references public.labs (id, clinic_id)
);

alter table public.lab_items enable row level security;

drop policy if exists lab_items_read  on public.lab_items;
drop policy if exists lab_items_write on public.lab_items;

-- Everyone books lab work, so everyone needs the prices; only the owner sets them.
create policy lab_items_read on public.lab_items
  for select using (public.is_member(clinic_id));
create policy lab_items_write on public.lab_items
  for all using (public.has_role(clinic_id, array['owner']::public.member_role[]))
       with check (public.has_role(clinic_id, array['owner']::public.member_role[]));

grant select, insert, update, delete on public.lab_items to authenticated;

-- The two kinds the clinic uses, for every clinic that has none yet.
insert into public.lab_items (clinic_id, name, unit_price)
select c.id, v.name, v.price
from public.clinics c
cross join (values ('زيركون', 550), ('بورسلين', 500)) as v(name, price)
where not exists (select 1 from public.lab_items li where li.clinic_id = c.id)
on conflict (clinic_id, name) do nothing;

-- ---------------------------------------------------------------------
-- 2. How long each stage is allowed to take
-- ---------------------------------------------------------------------
alter table public.clinics
  add column if not exists lab_stage_days smallint not null default 2
    check (lab_stage_days between 1 and 30);

grant update (lab_stage_days) on public.clinics to authenticated;

-- ---------------------------------------------------------------------
-- 3. The case: what it is, how much, and where it has got to
-- ---------------------------------------------------------------------
alter table public.lab_cases
  add column if not exists item_id           uuid references public.lab_items(id),
  add column if not exists units             numeric(6,2) not null default 1 check (units > 0),
  add column if not exists unit_price        numeric(12,2) check (unit_price >= 0),
  add column if not exists needs_tryin       boolean not null default true,
  add column if not exists tryin_expected_on date,
  add column if not exists tryin_received_on date,   -- the trial arrived from the lab
  add column if not exists tryin_done_on     date,   -- the patient tried it
  add column if not exists invoiced_amount   numeric(12,2) check (invoiced_amount >= 0);

do $$ begin
  alter table public.lab_cases add constraint lab_cases_tryin_order
    check (tryin_done_on is null or tryin_received_on is not null);
exception when duplicate_object then null; end $$;

create index if not exists lab_cases_stage_idx
  on public.lab_cases (clinic_id, tryin_expected_on)
  where received_on is null and cancelled_at is null;

-- Price the case, and set the stage dates, from the moment it is opened.
create or replace function public.price_lab_case()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_days int;
begin
  -- The price is copied onto the case, not read through a join: a lab that
  -- raises its prices next month must not rewrite what last month cost.
  if new.item_id is not null and new.unit_price is null then
    select unit_price into new.unit_price from public.lab_items where id = new.item_id;
  end if;

  if new.item_id is not null and new.unit_price is not null then
    new.lab_fee := round(new.units * new.unit_price, 2);
  end if;

  select lab_stage_days into v_days from public.clinics where id = new.clinic_id;
  v_days := coalesce(v_days, 2);

  if new.tryin_expected_on is null and new.needs_tryin then
    new.tryin_expected_on := new.sent_on + v_days;
  end if;

  -- Delivery is due two days after the patient's try-in; until that happens
  -- the original estimate stands.
  if new.needs_tryin and new.tryin_done_on is not null
     and (tg_op = 'INSERT' or new.tryin_done_on is distinct from old.tryin_done_on) then
    new.expected_on := greatest(new.tryin_done_on + v_days, new.sent_on);
  end if;

  return new;
end;
$$;

drop trigger if exists lab_cases_price on public.lab_cases;
create trigger lab_cases_price
  before insert or update of item_id, units, unit_price, needs_tryin, tryin_done_on, sent_on
  on public.lab_cases
  for each row execute function public.price_lab_case();

revoke execute on function public.price_lab_case() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. The view the screens read: which stage, what is next, is it late
-- ---------------------------------------------------------------------
-- lab_cases has gained columns since the view was written, and `lc.*` changes
-- shape with them, so the view is replaced rather than patched.
drop view if exists public.lab_case_status;

create view public.lab_case_status with (security_invoker = true) as
select
  lc.*,
  l.name as lab_name,
  li.name as item_name,
  p.full_name,
  case
    when lc.cancelled_at is not null        then 'cancelled'
    when lc.fitted_on is not null           then 'fitted'
    when lc.received_on is not null         then 'received'
    when t.today > lc.expected_on           then 'late'
    else 'at_lab'
  end as status,
  -- The stage, in the clinic's own terms.
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

-- ---------------------------------------------------------------------
-- 5. Checking the lab's monthly invoice
-- ---------------------------------------------------------------------
-- What the clinic expects to be billed, per lab, for work that came back
-- in the period — the figure to hold the invoice against.
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
         round(sum(lc.units), 2),
         round(sum(coalesce(lc.lab_fee, 0)), 2),
         round(sum(coalesce(lc.invoiced_amount, 0)), 2),
         round(sum(coalesce(lc.invoiced_amount, 0)) - sum(coalesce(lc.lab_fee, 0)), 2)
  from public.lab_cases lc
  join public.labs l on l.id = lc.lab_id
  where lc.clinic_id = p_clinic
    and lc.cancelled_at is null
    and lc.received_on between p_from and p_to
  group by l.id, l.name
  order by l.name;
end;
$$;

grant execute on function public.lab_invoice_check(uuid, date, date) to authenticated;
