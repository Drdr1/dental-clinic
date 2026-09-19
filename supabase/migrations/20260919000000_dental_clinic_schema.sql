-- =====================================================================
-- Dental Clinic System — Phase 1–3 schema
-- Target: Supabase (PostgreSQL 15+)
--
-- Covers: tenancy & roles, patients, chairs, procedures, appointments,
-- treatment plans, sessions, patient files, installment plans,
-- payments (append-only) with FIFO allocation, reversals, plan revisions,
-- session lock with doctor override, and reporting views.
--
-- Business rules (agreed):
--   * Installment price = cash price. Discount lives on the treatment plan.
--   * Fixed monthly installments; due dates computed from the first due
--     date (clamped to month end when the day doesn't exist, no drift).
--   * Grace period (clinics.grace_days) before an installment is overdue.
--   * No late fees — reminders and follow-up only.
--   * New sessions on a plan are blocked when overdue installments reach
--     clinics.lock_threshold (default 2). Doctor/owner can override with
--     a written reason; the override is logged.
--   * Payments are never updated or deleted. Mistakes => reverse_payment().
-- =====================================================================

create extension if not exists btree_gist;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.member_role             as enum ('owner', 'doctor', 'receptionist');
create type public.appointment_status      as enum ('booked', 'arrived', 'in_session', 'done', 'cancelled', 'no_show');
create type public.plan_status             as enum ('draft', 'active', 'completed', 'cancelled');
create type public.plan_item_status        as enum ('planned', 'done', 'cancelled');
create type public.installment_plan_status as enum ('active', 'completed', 'cancelled');
create type public.payment_method          as enum ('cash', 'card', 'instapay', 'wallet', 'bank_transfer');
create type public.file_kind               as enum ('xray', 'photo', 'document');

-- ---------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------
create table public.clinics (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  timezone         text not null default 'Africa/Cairo',
  currency         text not null default 'EGP',
  grace_days       smallint not null default 3 check (grace_days between 0 and 30),
  lock_threshold   smallint not null default 2 check (lock_threshold >= 1),
  next_receipt_no  bigint   not null default 1,
  created_at       timestamptz not null default now()
);

create table public.clinic_members (
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          public.member_role not null,
  display_name  text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

-- ---------------------------------------------------------------------
-- Auth helpers (used by RLS policies and RPCs)
-- ---------------------------------------------------------------------
create or replace function public.has_role(p_clinic uuid, p_roles public.member_role[])
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.clinic_members m
    where m.clinic_id = p_clinic
      and m.user_id   = auth.uid()
      and m.active
      and m.role = any (p_roles)
  );
$$;

create or replace function public.is_member(p_clinic uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.has_role(p_clinic, array['owner','doctor','receptionist']::public.member_role[]);
$$;

create or replace function public.is_doctor(p_clinic uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.has_role(p_clinic, array['owner','doctor']::public.member_role[]);
$$;

-- "Today" in the clinic's own timezone, not the server's UTC date.
create or replace function public.clinic_today(p_clinic uuid)
returns date
language sql stable
set search_path = public, pg_temp
as $$
  select (now() at time zone c.timezone)::date from public.clinics c where c.id = p_clinic;
$$;

-- ---------------------------------------------------------------------
-- Clinic setup
-- ---------------------------------------------------------------------
create table public.chairs (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  unique (clinic_id, name),
  unique (id, clinic_id)
);

create table public.procedures (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null references public.clinics(id) on delete cascade,
  name                  text not null,
  default_price         numeric(12,2) not null check (default_price >= 0),
  default_duration_min  smallint not null default 30 check (default_duration_min > 0),
  aftercare_template    text,            -- used by Phase 6 follow-ups
  active                boolean not null default true,
  unique (clinic_id, name),
  unique (id, clinic_id)
);

-- ---------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------
create table public.patients (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  full_name       text not null,
  phone           text not null,
  whatsapp_phone  text,                  -- defaults to phone in the app if empty
  gender          text check (gender in ('male', 'female')),
  date_of_birth   date,
  medical_alerts  text,                  -- shown prominently before any session
  notes           text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (id, clinic_id)
);
create index patients_clinic_phone_idx on public.patients (clinic_id, phone);
create index patients_name_trgm_idx    on public.patients using gin (full_name gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------
create table public.appointments (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  patient_id  uuid not null,
  chair_id    uuid not null,
  doctor_id   uuid,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      public.appointment_status not null default 'booked',
  notes       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (chair_id,   clinic_id) references public.chairs   (id, clinic_id),
  foreign key (clinic_id,  doctor_id) references public.clinic_members (clinic_id, user_id),
  -- No double-booking the same chair (cancelled / no-show slots are free again).
  constraint appointments_no_overlap exclude using gist (
    chair_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status not in ('cancelled', 'no_show'))
);
create index appointments_clinic_start_idx on public.appointments (clinic_id, starts_at);
create index appointments_patient_idx      on public.appointments (patient_id);

-- ---------------------------------------------------------------------
-- Treatment plans
-- ---------------------------------------------------------------------
create table public.treatment_plans (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  patient_id  uuid not null,
  title       text not null,
  discount    numeric(12,2) not null default 0 check (discount >= 0),
  status      public.plan_status not null default 'draft',
  notes       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id)
);
create index treatment_plans_patient_idx on public.treatment_plans (patient_id);

create table public.treatment_plan_items (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references public.clinics(id) on delete cascade,
  plan_id             uuid not null,
  procedure_id        uuid,
  tooth_number        smallint check (tooth_number is null or tooth_number between 11 and 85), -- FDI
  description         text,
  price               numeric(12,2) not null check (price >= 0),
  status              public.plan_item_status not null default 'planned',
  done_in_session_id  uuid,
  created_at          timestamptz not null default now(),
  foreign key (plan_id,      clinic_id) references public.treatment_plans (id, clinic_id) on delete cascade,
  foreign key (procedure_id, clinic_id) references public.procedures      (id, clinic_id)
);
create index treatment_plan_items_plan_idx on public.treatment_plan_items (plan_id);

-- Net price of a plan: active items minus the plan discount.
create or replace function public.plan_net_total(p_plan uuid)
returns numeric
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce((select sum(i.price) from public.treatment_plan_items i
                   where i.plan_id = p.id and i.status <> 'cancelled'), 0) - p.discount
  from public.treatment_plans p where p.id = p_plan;
$$;

-- ---------------------------------------------------------------------
-- Sessions (visits) and files
-- ---------------------------------------------------------------------
create table public.sessions (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics(id) on delete cascade,
  patient_id         uuid not null,
  treatment_plan_id  uuid,
  appointment_id     uuid,
  performed_by       uuid default auth.uid(),
  performed_at       timestamptz not null default now(),
  notes              text,
  lock_override      boolean not null default false,
  override_reason    text,
  override_by        uuid,
  created_at         timestamptz not null default now(),
  check (not lock_override or length(trim(coalesce(override_reason, ''))) > 0),
  unique (id, clinic_id),
  foreign key (patient_id,        clinic_id) references public.patients        (id, clinic_id),
  foreign key (treatment_plan_id, clinic_id) references public.treatment_plans (id, clinic_id),
  foreign key (appointment_id,    clinic_id) references public.appointments    (id, clinic_id)
);
create index sessions_patient_idx on public.sessions (patient_id);

alter table public.treatment_plan_items
  add foreign key (done_in_session_id, clinic_id) references public.sessions (id, clinic_id);

create table public.patient_files (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  patient_id    uuid not null,
  session_id    uuid,
  kind          public.file_kind not null,
  storage_path  text not null,           -- '{clinic_id}/{patient_id}/{file}' in the patient-files bucket
  caption       text,
  uploaded_by   uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (session_id, clinic_id) references public.sessions (id, clinic_id)
);

-- ---------------------------------------------------------------------
-- Installments
-- ---------------------------------------------------------------------
create table public.installment_plans (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics(id),
  patient_id         uuid not null,
  treatment_plan_id  uuid not null,
  net_total          numeric(12,2) not null check (net_total > 0),
  down_payment       numeric(12,2) not null default 0 check (down_payment >= 0),
  months             smallint not null check (months between 0 and 60),
  first_due_date     date,
  status             public.installment_plan_status not null default 'active',
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  check (down_payment <= net_total),
  unique (id, clinic_id),
  foreign key (patient_id,        clinic_id) references public.patients        (id, clinic_id),
  foreign key (treatment_plan_id, clinic_id) references public.treatment_plans (id, clinic_id)
);
create unique index installment_plans_one_active
  on public.installment_plans (treatment_plan_id) where status = 'active';

create table public.installments (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references public.clinics(id),
  installment_plan_id  uuid not null,
  seq                  smallint not null,          -- 0 = down payment, 1..n = monthly
  is_down_payment      boolean not null default false,
  due_date             date not null,
  amount               numeric(12,2) not null check (amount >= 0),
  cancelled_at         timestamptz,                -- set when a plan revision replaces it
  created_at           timestamptz not null default now(),
  unique (installment_plan_id, seq),
  unique (id, clinic_id),
  foreign key (installment_plan_id, clinic_id) references public.installment_plans (id, clinic_id)
);
create index installments_due_idx on public.installments (clinic_id, due_date);

create table public.installment_plan_revisions (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references public.clinics(id),
  installment_plan_id  uuid not null,
  old_net_total        numeric(12,2) not null,
  new_net_total        numeric(12,2) not null,
  paid_at_revision     numeric(12,2) not null,
  new_months           smallint not null,
  reason               text not null check (length(trim(reason)) > 0),
  changed_by           uuid default auth.uid(),
  changed_at           timestamptz not null default now(),
  foreign key (installment_plan_id, clinic_id) references public.installment_plans (id, clinic_id)
);

-- ---------------------------------------------------------------------
-- Payments (append-only)
-- ---------------------------------------------------------------------
create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references public.clinics(id),
  patient_id           uuid not null,
  installment_plan_id  uuid,                 -- null = direct payment (no installments)
  treatment_plan_id    uuid,
  receipt_no           bigint not null,
  amount               numeric(12,2) not null check (amount <> 0),  -- negative = reversal
  method               public.payment_method not null,
  received_at          timestamptz not null default now(),
  received_by          uuid default auth.uid(),
  note                 text,
  reverses_payment_id  uuid unique references public.payments(id),
  created_at           timestamptz not null default now(),
  check ((amount > 0) = (reverses_payment_id is null)),
  unique (clinic_id, receipt_no),
  unique (id, clinic_id),
  foreign key (patient_id,          clinic_id) references public.patients          (id, clinic_id),
  foreign key (installment_plan_id, clinic_id) references public.installment_plans (id, clinic_id),
  foreign key (treatment_plan_id,   clinic_id) references public.treatment_plans   (id, clinic_id)
);
create index payments_patient_idx on public.payments (patient_id);
create index payments_plan_idx    on public.payments (installment_plan_id);

create table public.payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id),
  payment_id      uuid not null,
  installment_id  uuid not null,
  amount          numeric(12,2) not null check (amount <> 0),
  created_at      timestamptz not null default now(),
  foreign key (payment_id,     clinic_id) references public.payments     (id, clinic_id),
  foreign key (installment_id, clinic_id) references public.installments (id, clinic_id)
);
create index payment_allocations_installment_idx on public.payment_allocations (installment_id);

create or replace function public.forbid_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only; use reverse_payment() to correct mistakes', tg_table_name;
end;
$$;

create trigger payments_append_only
  before update or delete on public.payments
  for each row execute function public.forbid_mutation();
create trigger payment_allocations_append_only
  before update or delete on public.payment_allocations
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------
-- Views (security_invoker => RLS of the querying user applies)
-- ---------------------------------------------------------------------

-- Status of every installment, computed at read time (no cron needed).
create view public.installment_status with (security_invoker = true) as
select
  i.id,
  i.clinic_id,
  i.installment_plan_id,
  ip.patient_id,
  ip.treatment_plan_id,
  i.seq,
  i.is_down_payment,
  i.due_date,
  (i.due_date + c.grace_days)                    as grace_end,
  i.amount,
  coalesce(a.paid, 0)                            as paid,
  i.amount - coalesce(a.paid, 0)                 as remaining,
  a.last_paid_at,
  (coalesce(a.paid, 0) > 0 and coalesce(a.paid, 0) < i.amount) as is_partial,
  case
    when i.cancelled_at is not null or ip.status = 'cancelled' then 'cancelled'
    when coalesce(a.paid, 0) >= i.amount                        then 'paid'
    when t.today > i.due_date + c.grace_days                    then 'overdue'
    when t.today > i.due_date                                   then 'in_grace'
    when t.today = i.due_date                                   then 'due'
    else 'upcoming'
  end                                            as status,
  case
    when i.cancelled_at is null and ip.status <> 'cancelled'
     and coalesce(a.paid, 0) < i.amount
     and t.today > i.due_date + c.grace_days
    then t.today - (i.due_date + c.grace_days)
    else 0
  end                                            as days_overdue
from public.installments i
join public.installment_plans ip on ip.id = i.installment_plan_id
join public.clinics c            on c.id  = i.clinic_id
cross join lateral (select (now() at time zone c.timezone)::date as today) t
left join lateral (
  select sum(pa.amount) as paid, max(p.received_at) as last_paid_at
  from public.payment_allocations pa
  join public.payments p on p.id = pa.payment_id
  where pa.installment_id = i.id
) a on true;

-- One row per installment plan: totals, overdue count, next due, lock state.
create view public.installment_plan_summary with (security_invoker = true) as
select
  ip.id                    as installment_plan_id,
  ip.clinic_id,
  ip.patient_id,
  ip.treatment_plan_id,
  ip.status,
  ip.net_total,
  public.plan_net_total(ip.treatment_plan_id) as current_plan_total,
  (public.plan_net_total(ip.treatment_plan_id) <> ip.net_total and ip.status = 'active')
                           as needs_revision,   -- treatment changed; call revise_installment_plan()
  coalesce(sum(s.paid), 0)                                                            as total_paid,
  coalesce(sum(s.remaining) filter (where s.status <> 'cancelled'), 0)              as outstanding,
  count(*) filter (where s.status = 'overdue')                                        as overdue_count,
  coalesce(sum(s.remaining) filter (where s.status = 'overdue'), 0)                  as overdue_amount,
  min(s.due_date) filter (where s.status in ('upcoming','due','in_grace','overdue')) as next_due_date,
  (count(*) filter (where s.status = 'overdue')) >= c.lock_threshold                 as sessions_locked
from public.installment_plans ip
join public.clinics c on c.id = ip.clinic_id
left join public.installment_status s on s.installment_plan_id = ip.id
group by ip.id, c.lock_threshold;

-- Receptionist's daily list: overdue, in grace, due today, and the next 7 days.
create view public.installment_agenda with (security_invoker = true) as
select
  s.*,
  p.full_name,
  p.phone,
  coalesce(p.whatsapp_phone, p.phone) as whatsapp_phone
from public.installment_status s
join public.patients p on p.id = s.patient_id
join public.clinics c  on c.id = s.clinic_id
where s.status in ('overdue', 'in_grace', 'due')
   or (s.status = 'upcoming' and s.due_date <= (now() at time zone c.timezone)::date + 7);

-- Payment reliability per patient (used when offering a new installment plan).
create view public.patient_payment_reliability with (security_invoker = true) as
select
  s.clinic_id,
  s.patient_id,
  count(*) filter (where s.status = 'paid' and not s.is_down_payment)                as installments_paid,
  count(*) filter (where s.status = 'paid' and not s.is_down_payment
                     and (s.last_paid_at at time zone c.timezone)::date > s.grace_end) as paid_late,
  round(avg(greatest((s.last_paid_at at time zone c.timezone)::date - s.due_date, 0))
        filter (where s.status = 'paid' and not s.is_down_payment), 1)               as avg_days_after_due,
  count(*) filter (where s.status = 'overdue')                                        as currently_overdue,
  coalesce(sum(s.remaining) filter (where s.status = 'overdue'), 0)                  as overdue_amount
from public.installment_status s
join public.clinics c on c.id = s.clinic_id
group by s.clinic_id, s.patient_id;

-- ---------------------------------------------------------------------
-- Session lock (enforced in the database, not just the UI)
-- ---------------------------------------------------------------------
create or replace function public.enforce_session_lock()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_overdue    int;
  v_threshold  int;
begin
  if tg_op = 'UPDATE' then
    if new.treatment_plan_id is distinct from old.treatment_plan_id
       or new.lock_override  is distinct from old.lock_override
       or new.override_reason is distinct from old.override_reason
       or new.override_by    is distinct from old.override_by then
      raise exception 'Plan link and override fields of a session cannot be changed after creation';
    end if;
    return new;
  end if;

  new.override_by := null;
  if new.treatment_plan_id is null then
    new.lock_override := false;
    new.override_reason := null;
    return new;
  end if;

  select c.lock_threshold into v_threshold from public.clinics c where c.id = new.clinic_id;

  select count(*) into v_overdue
  from public.installment_status s
  join public.installment_plans ip on ip.id = s.installment_plan_id
  where ip.treatment_plan_id = new.treatment_plan_id
    and ip.status = 'active'
    and s.status = 'overdue';

  if v_overdue >= v_threshold then
    if not new.lock_override then
      raise exception 'SESSION_LOCKED: % overdue installments (limit %). A doctor override is required.',
        v_overdue, v_threshold using errcode = 'P0001';
    end if;
    if not public.is_doctor(new.clinic_id) then
      raise exception 'Only a doctor can override a locked session' using errcode = '42501';
    end if;
    new.override_by := auth.uid();
  else
    new.lock_override := false;
    new.override_reason := null;
  end if;

  return new;
end;
$$;

create trigger sessions_enforce_lock
  before insert or update on public.sessions
  for each row execute function public.enforce_session_lock();

-- ---------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------
create or replace function public._next_receipt_no(p_clinic uuid)
returns bigint
language sql
set search_path = public, pg_temp
as $$
  update public.clinics set next_receipt_no = next_receipt_no + 1
  where id = p_clinic
  returning next_receipt_no - 1;
$$;

-- Splits p_balance into p_months equal whole-pound installments; the last one
-- absorbs the rounding difference. Due dates are always first_due + k months,
-- so a 31st start gives 31 Jan, 28 Feb, 31 Mar, 30 Apr ... (no drift).
create or replace function public._generate_installments(
  p_installment_plan uuid, p_clinic uuid, p_balance numeric,
  p_months int, p_first_due date, p_start_seq int)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_base numeric(12,2);
  k int;
begin
  if p_balance <= 0 then return; end if;
  if p_months < 1 then raise exception 'At least one month is required for a remaining balance'; end if;
  if p_first_due is null then raise exception 'First due date is required'; end if;

  v_base := trunc(p_balance / p_months);
  if v_base <= 0 then raise exception 'Balance too small for % monthly installments', p_months; end if;

  for k in 0 .. p_months - 1 loop
    insert into public.installments (clinic_id, installment_plan_id, seq, due_date, amount)
    values (
      p_clinic, p_installment_plan, p_start_seq + k,
      (p_first_due + make_interval(months => k))::date,
      case when k = p_months - 1 then p_balance - v_base * (p_months - 1) else v_base end
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- RPCs (the only way to write financial data)
-- ---------------------------------------------------------------------

-- Creates the clinic and makes the caller its owner.
create or replace function public.create_clinic(p_name text, p_display_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.clinics (name) values (p_name) returning id into v_id;
  insert into public.clinic_members (clinic_id, user_id, role, display_name)
  values (v_id, auth.uid(), 'owner', p_display_name);
  return v_id;
end;
$$;

-- Creates an installment plan for a treatment plan (doctor/owner).
-- Down payment becomes installment #0, due today.
create or replace function public.create_installment_plan(
  p_treatment_plan_id uuid,
  p_down_payment      numeric,
  p_months            int,
  p_first_due_date    date)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_plan  public.treatment_plans;
  v_net   numeric(12,2);
  v_id    uuid;
begin
  select * into v_plan from public.treatment_plans where id = p_treatment_plan_id for update;
  if not found then raise exception 'Treatment plan not found'; end if;
  if not public.is_doctor(v_plan.clinic_id) then
    raise exception 'Only a doctor can set installment terms' using errcode = '42501';
  end if;
  if v_plan.status in ('completed', 'cancelled') then
    raise exception 'Treatment plan is %', v_plan.status;
  end if;

  v_net := public.plan_net_total(p_treatment_plan_id);
  if v_net <= 0 then raise exception 'Plan total must be greater than zero'; end if;
  if p_down_payment is null or p_down_payment < 0 or p_down_payment > v_net then
    raise exception 'Down payment must be between 0 and %', v_net;
  end if;
  if p_down_payment = v_net and coalesce(p_months, 0) <> 0 then
    raise exception 'Down payment covers the full amount; months must be 0';
  end if;

  insert into public.installment_plans
    (clinic_id, patient_id, treatment_plan_id, net_total, down_payment, months, first_due_date)
  values
    (v_plan.clinic_id, v_plan.patient_id, v_plan.id, v_net, p_down_payment, coalesce(p_months, 0), p_first_due_date)
  returning id into v_id;

  if p_down_payment > 0 then
    insert into public.installments (clinic_id, installment_plan_id, seq, is_down_payment, due_date, amount)
    values (v_plan.clinic_id, v_id, 0, true, public.clinic_today(v_plan.clinic_id), p_down_payment);
  end if;

  perform public._generate_installments(
    v_id, v_plan.clinic_id, v_net - p_down_payment, coalesce(p_months, 0), p_first_due_date, 1);

  update public.treatment_plans set status = 'active' where id = v_plan.id and status = 'draft';
  return v_id;
end;
$$;

-- Records a payment on an installment plan and allocates it FIFO
-- (oldest open installment first). Handles partial and multi-installment payments.
create or replace function public.record_payment(
  p_installment_plan_id uuid,
  p_amount              numeric,
  p_method              public.payment_method,
  p_note                text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ip           public.installment_plans;
  v_outstanding  numeric(12,2);
  v_left         numeric(12,2);
  v_take         numeric(12,2);
  v_pay_id       uuid;
  r              record;
begin
  select * into v_ip from public.installment_plans where id = p_installment_plan_id for update;
  if not found then raise exception 'Installment plan not found'; end if;
  if not public.is_member(v_ip.clinic_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if v_ip.status <> 'active' then raise exception 'Installment plan is %', v_ip.status; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  select coalesce(sum(remaining), 0) into v_outstanding
  from public.installment_status
  where installment_plan_id = v_ip.id and status <> 'cancelled';

  if p_amount > v_outstanding then
    raise exception 'Amount % exceeds outstanding balance %', p_amount, v_outstanding;
  end if;

  insert into public.payments
    (clinic_id, patient_id, installment_plan_id, treatment_plan_id, receipt_no, amount, method, note)
  values
    (v_ip.clinic_id, v_ip.patient_id, v_ip.id, v_ip.treatment_plan_id,
     public._next_receipt_no(v_ip.clinic_id), p_amount, p_method, p_note)
  returning id into v_pay_id;

  v_left := p_amount;
  for r in
    select id, remaining from public.installment_status
    where installment_plan_id = v_ip.id and status <> 'cancelled' and remaining > 0
    order by seq
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.remaining);
    insert into public.payment_allocations (clinic_id, payment_id, installment_id, amount)
    values (v_ip.clinic_id, v_pay_id, r.id, v_take);
    v_left := v_left - v_take;
  end loop;

  if v_outstanding - p_amount = 0 then
    update public.installment_plans set status = 'completed' where id = v_ip.id;
  end if;

  return v_pay_id;
end;
$$;

-- Payment without an installment plan (e.g. paying per session in cash).
create or replace function public.record_direct_payment(
  p_patient_id        uuid,
  p_amount            numeric,
  p_method            public.payment_method,
  p_treatment_plan_id uuid default null,
  p_note              text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic uuid;
  v_id     uuid;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if not found then raise exception 'Patient not found'; end if;
  if not public.is_member(v_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  insert into public.payments (clinic_id, patient_id, treatment_plan_id, receipt_no, amount, method, note)
  values (v_clinic, p_patient_id, p_treatment_plan_id, public._next_receipt_no(v_clinic), p_amount, p_method, p_note)
  returning id into v_id;
  return v_id;
end;
$$;

-- Reverses a payment with a mirrored negative entry (doctor/owner only).
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_pay  public.payments;
  v_id   uuid;
begin
  select * into v_pay from public.payments where id = p_payment_id;
  if not found then raise exception 'Payment not found'; end if;
  if not public.is_doctor(v_pay.clinic_id) then
    raise exception 'Only a doctor can reverse payments' using errcode = '42501';
  end if;
  if v_pay.amount < 0 then raise exception 'Cannot reverse a reversal'; end if;
  if exists (select 1 from public.payments where reverses_payment_id = v_pay.id) then
    raise exception 'Payment already reversed';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required'; end if;

  if v_pay.installment_plan_id is not null then
    perform 1 from public.installment_plans where id = v_pay.installment_plan_id for update;
  end if;

  insert into public.payments
    (clinic_id, patient_id, installment_plan_id, treatment_plan_id, receipt_no,
     amount, method, note, reverses_payment_id)
  values
    (v_pay.clinic_id, v_pay.patient_id, v_pay.installment_plan_id, v_pay.treatment_plan_id,
     public._next_receipt_no(v_pay.clinic_id), -v_pay.amount, v_pay.method, p_reason, v_pay.id)
  returning id into v_id;

  insert into public.payment_allocations (clinic_id, payment_id, installment_id, amount)
  select clinic_id, v_id, installment_id, -amount
  from public.payment_allocations where payment_id = v_pay.id;

  update public.installment_plans set status = 'active'
  where id = v_pay.installment_plan_id and status = 'completed';

  return v_id;
end;
$$;

-- Re-plans the remaining balance after the treatment changed (doctor/owner).
-- Paid history is kept; open installments are closed out and the new balance
-- (new plan total - everything paid) is spread over p_months from p_first_due_date.
create or replace function public.revise_installment_plan(
  p_installment_plan_id uuid,
  p_months              int,
  p_first_due_date      date,
  p_reason              text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ip       public.installment_plans;
  v_new_net  numeric(12,2);
  v_paid     numeric(12,2);
  v_next_seq int;
  r          record;
begin
  select * into v_ip from public.installment_plans where id = p_installment_plan_id for update;
  if not found then raise exception 'Installment plan not found'; end if;
  if not public.is_doctor(v_ip.clinic_id) then
    raise exception 'Only a doctor can revise installment terms' using errcode = '42501';
  end if;
  if v_ip.status = 'cancelled' then raise exception 'Installment plan is cancelled'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required'; end if;

  v_new_net := public.plan_net_total(v_ip.treatment_plan_id);

  select coalesce(sum(pa.amount), 0) into v_paid
  from public.payment_allocations pa
  join public.installments i on i.id = pa.installment_id
  where i.installment_plan_id = v_ip.id;

  if v_new_net < v_paid then
    raise exception 'New total % is below the amount already paid %; handle the refund first', v_new_net, v_paid;
  end if;

  -- Close out every open installment: partially paid ones shrink to what was paid,
  -- untouched ones are cancelled.
  for r in
    select id, paid from public.installment_status
    where installment_plan_id = v_ip.id and status <> 'cancelled' and remaining > 0
  loop
    if r.paid > 0 then
      update public.installments set amount = r.paid where id = r.id;
    else
      update public.installments set cancelled_at = now() where id = r.id;
    end if;
  end loop;

  select coalesce(max(seq), 0) + 1 into v_next_seq
  from public.installments where installment_plan_id = v_ip.id;

  perform public._generate_installments(
    v_ip.id, v_ip.clinic_id, v_new_net - v_paid, coalesce(p_months, 0), p_first_due_date, v_next_seq);

  insert into public.installment_plan_revisions
    (clinic_id, installment_plan_id, old_net_total, new_net_total, paid_at_revision, new_months, reason)
  values
    (v_ip.clinic_id, v_ip.id, v_ip.net_total, v_new_net, v_paid, coalesce(p_months, 0), p_reason);

  update public.installment_plans
  set net_total = v_new_net,
      status = case when v_new_net - v_paid = 0 then 'completed'::public.installment_plan_status
                    else 'active'::public.installment_plan_status end
  where id = v_ip.id;
end;
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.clinics                    enable row level security;
alter table public.clinic_members             enable row level security;
alter table public.chairs                     enable row level security;
alter table public.procedures                 enable row level security;
alter table public.patients                   enable row level security;
alter table public.appointments               enable row level security;
alter table public.treatment_plans            enable row level security;
alter table public.treatment_plan_items       enable row level security;
alter table public.sessions                   enable row level security;
alter table public.patient_files              enable row level security;
alter table public.installment_plans          enable row level security;
alter table public.installments               enable row level security;
alter table public.installment_plan_revisions enable row level security;
alter table public.payments                   enable row level security;
alter table public.payment_allocations        enable row level security;

-- Clinics: members read; owner edits settings (column grants below limit which).
create policy clinics_select on public.clinics for select to authenticated
  using (public.is_member(id));
create policy clinics_update on public.clinics for update to authenticated
  using (public.has_role(id, array['owner']::public.member_role[]))
  with check (public.has_role(id, array['owner']::public.member_role[]));

-- Members: everyone in the clinic sees the team; only the owner manages it.
create policy members_select on public.clinic_members for select to authenticated
  using (public.is_member(clinic_id));
create policy members_insert on public.clinic_members for insert to authenticated
  with check (public.has_role(clinic_id, array['owner']::public.member_role[]));
create policy members_update on public.clinic_members for update to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]))
  with check (public.has_role(clinic_id, array['owner']::public.member_role[]));
create policy members_delete on public.clinic_members for delete to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]));

-- Clinic setup (chairs, procedures/prices): members read, owner writes.
do $$
declare t text;
begin
  foreach t in array array['chairs', 'procedures'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated
                      using (public.is_member(clinic_id))', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated
                      using (public.has_role(clinic_id, array[''owner'']::public.member_role[]))
                      with check (public.has_role(clinic_id, array[''owner'']::public.member_role[]))', t);
  end loop;
end $$;

-- Day-to-day clinical data: every member reads/inserts/updates; only owner deletes.
do $$
declare t text;
begin
  foreach t in array array['patients', 'appointments', 'treatment_plans',
                           'treatment_plan_items', 'sessions', 'patient_files'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated
                      using (public.is_member(clinic_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated
                      with check (public.is_member(clinic_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated
                      using (public.is_member(clinic_id)) with check (public.is_member(clinic_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated
                      using (public.has_role(clinic_id, array[''owner'']::public.member_role[]))', t);
  end loop;
end $$;

-- Financial data: read-only for members. All writes go through the RPCs above.
do $$
declare t text;
begin
  foreach t in array array['installment_plans', 'installments', 'installment_plan_revisions',
                           'payments', 'payment_allocations'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated
                      using (public.is_member(clinic_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;

-- Clinic settings: the owner may change only these columns.
revoke update on public.clinics from authenticated;
grant  update (name, timezone, grace_days, lock_threshold) on public.clinics to authenticated;

-- Financial tables: no direct writes even if a policy were added later.
revoke insert, update, delete on public.installment_plans, public.installments,
  public.installment_plan_revisions, public.payments, public.payment_allocations
  from authenticated;

grant select on public.installment_status, public.installment_plan_summary,
  public.installment_agenda, public.patient_payment_reliability to authenticated;

-- Internal helpers stay internal.
revoke execute on function public._next_receipt_no(uuid) from authenticated;
revoke execute on function public._generate_installments(uuid, uuid, numeric, int, date, int) from authenticated;

grant execute on function
  public.has_role(uuid, public.member_role[]),
  public.is_member(uuid),
  public.is_doctor(uuid),
  public.clinic_today(uuid),
  public.plan_net_total(uuid),
  public.create_clinic(text, text),
  public.create_installment_plan(uuid, numeric, int, date),
  public.record_payment(uuid, numeric, public.payment_method, text),
  public.record_direct_payment(uuid, numeric, public.payment_method, uuid, text),
  public.reverse_payment(uuid, text),
  public.revise_installment_plan(uuid, int, date, text)
to authenticated;

-- ---------------------------------------------------------------------
-- Storage (run in Supabase; kept commented so the file also runs on plain Postgres)
-- Private bucket, paths: {clinic_id}/{patient_id}/{filename}
-- ---------------------------------------------------------------------
-- insert into storage.buckets (id, name, public) values ('patient-files', 'patient-files', false);
--
-- create policy patient_files_read on storage.objects for select to authenticated
--   using (bucket_id = 'patient-files' and public.is_member(((storage.foldername(name))[1])::uuid));
-- create policy patient_files_upload on storage.objects for insert to authenticated
--   with check (bucket_id = 'patient-files' and public.is_member(((storage.foldername(name))[1])::uuid));
-- create policy patient_files_delete on storage.objects for delete to authenticated
--   using (bucket_id = 'patient-files'
--          and public.has_role(((storage.foldername(name))[1])::uuid, array['owner']::public.member_role[]));
