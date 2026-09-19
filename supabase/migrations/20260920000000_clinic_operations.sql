-- =====================================================================
-- Dental Clinic System — migration 0002: clinic operations
-- Requires: 0001_dental_clinic_schema.sql
--
-- Adds:
--   1. Treatment plan lifecycle (presented / declined) + case acceptance
--      and unscheduled-treatment reporting
--   2. Recall (routine / perio) with automatic next-due dates
--   3. Lab case tracking with turnaround and at-risk appointments
--   4. Medical history & consent forms, filled via a one-time link
--      (WhatsApp or reception tablet), signed and append-only
--   5. Installment agreements: versioned snapshot of the agreed terms,
--      created automatically on every new plan and every revision
--   +  cancel_installment_plan(), and a guard so a treatment plan can't be
--      cancelled while its installment plan is still active
--
-- Note: new enum values are only compared as text in this file, so the
-- migration is safe to run inside a single transaction.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Treatment plan lifecycle
-- ---------------------------------------------------------------------
alter type public.plan_status add value if not exists 'presented' after 'draft';
alter type public.plan_status add value if not exists 'declined'  after 'presented';

alter table public.treatment_plans
  add column presented_at    timestamptz,
  add column accepted_at     timestamptz,
  add column declined_at     timestamptz,
  add column decline_reason  text;

alter table public.installment_plans
  add column cancelled_at   timestamptz,
  add column cancel_reason  text;

-- Allowed transitions + automatic timestamps.
create or replace function public.treatment_plan_status_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_move text := old.status::text || '>' || new.status::text;
begin
  if new.status = old.status then
    return new;
  end if;

  if v_move not in (
    'draft>presented', 'draft>active', 'draft>cancelled',
    'presented>draft', 'presented>active', 'presented>declined', 'presented>cancelled',
    'declined>presented', 'declined>draft',
    'active>completed', 'active>cancelled'
  ) then
    raise exception 'Treatment plan cannot move from % to %', old.status, new.status;
  end if;

  if new.status::text = 'cancelled' and exists (
    select 1 from public.installment_plans
    where treatment_plan_id = new.id and status = 'active'
  ) then
    raise exception 'Cancel or settle the active installment plan first';
  end if;

  case new.status::text
    when 'presented' then
      new.presented_at   := now();
      new.declined_at    := null;
      new.decline_reason := null;
    when 'declined' then
      new.declined_at := now();
    when 'active' then
      new.accepted_at  := now();
      new.presented_at := coalesce(new.presented_at, now());  -- accepted on the spot
    else
      null;
  end case;

  return new;
end;
$$;

create trigger treatment_plans_status_guard
  before update of status on public.treatment_plans
  for each row execute function public.treatment_plan_status_guard();

-- Replaces the 0001 version: a plan can now be accepted from 'presented' too.
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
  if v_plan.status::text not in ('draft', 'presented', 'active') then
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

  if v_plan.status::text in ('draft', 'presented') then
    update public.treatment_plans set status = 'active' where id = v_plan.id;
  end if;

  return v_id;
end;
$$;

-- Cancels an installment plan (doctor/owner). Paid history stays; refunds go
-- through reverse_payment().
create or replace function public.cancel_installment_plan(p_installment_plan_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ip public.installment_plans;
begin
  select * into v_ip from public.installment_plans where id = p_installment_plan_id for update;
  if not found then raise exception 'Installment plan not found'; end if;
  if not public.is_doctor(v_ip.clinic_id) then
    raise exception 'Only a doctor can cancel installment plans' using errcode = '42501';
  end if;
  if v_ip.status <> 'active' then raise exception 'Installment plan is %', v_ip.status; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required'; end if;

  update public.installment_plans
  set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
  where id = v_ip.id;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. Recall
-- ---------------------------------------------------------------------
alter table public.patients
  add column recall_type             text not null default 'routine' check (recall_type in ('routine', 'perio')),
  add column recall_interval_months  smallint default 6 check (recall_interval_months between 1 and 24), -- null = no recall
  add column next_recall_due         date;

alter table public.sessions
  add column is_recall_visit boolean not null default false;   -- checkup / cleaning / perio maintenance

create index patients_recall_idx on public.patients (clinic_id, next_recall_due);

-- A recall visit sets the patient's next due date from their own interval.
create or replace function public.update_recall_after_session()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_recall_visit then
    update public.patients p
    set next_recall_due = ((new.performed_at at time zone c.timezone)::date
                           + make_interval(months => p.recall_interval_months))::date
    from public.clinics c
    where p.id = new.patient_id
      and c.id = p.clinic_id
      and p.recall_interval_months is not null;
  end if;
  return null;
end;
$$;

create trigger sessions_update_recall
  after insert or update of is_recall_visit on public.sessions
  for each row execute function public.update_recall_after_session();

-- Patients due within 30 days or overdue, with whether they're already booked.
create view public.recall_list with (security_invoker = true) as
select
  p.id           as patient_id,
  p.clinic_id,
  p.full_name,
  p.phone,
  coalesce(p.whatsapp_phone, p.phone) as whatsapp_phone,
  p.recall_type,
  p.next_recall_due,
  case
    when p.next_recall_due < t.today  then 'overdue'
    when p.next_recall_due = t.today  then 'due'
    else 'due_soon'
  end            as status,
  greatest(t.today - p.next_recall_due, 0) as days_overdue,
  exists (
    select 1 from public.appointments a
    where a.patient_id = p.id and a.status = 'booked' and a.starts_at > now()
  )              as has_upcoming_appointment
from public.patients p
join public.clinics c on c.id = p.clinic_id
cross join lateral (select (now() at time zone c.timezone)::date as today) t
where p.recall_interval_months is not null
  and p.next_recall_due is not null
  and p.next_recall_due <= t.today + 30;

-- ---------------------------------------------------------------------
-- 3. Lab cases
-- ---------------------------------------------------------------------
create table public.labs (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  name       text not null,
  phone      text,
  active     boolean not null default true,
  unique (clinic_id, name),
  unique (id, clinic_id)
);

create table public.lab_cases (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  patient_id    uuid not null,
  plan_item_id  uuid references public.treatment_plan_items(id),
  lab_id        uuid not null,
  description   text not null,              -- e.g. 'Zirconia crown, tooth 36'
  shade         text,
  lab_fee       numeric(12,2) check (lab_fee >= 0),
  sent_on       date not null,
  expected_on   date not null,
  received_on   date,
  fitted_on     date,
  cancelled_at  timestamptz,
  notes         text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  check (expected_on >= sent_on),
  check (received_on is null or received_on >= sent_on),
  check (fitted_on is null or (received_on is not null and fitted_on >= received_on)),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  foreign key (lab_id,     clinic_id) references public.labs     (id, clinic_id)
);
create index lab_cases_open_idx on public.lab_cases (clinic_id, expected_on) where received_on is null;

-- at_risk: not back from the lab yet, but the patient is booked within 3 days.
create view public.lab_case_status with (security_invoker = true) as
select
  lc.*,
  l.name as lab_name,
  p.full_name,
  case
    when lc.cancelled_at is not null         then 'cancelled'
    when lc.fitted_on   is not null          then 'fitted'
    when lc.received_on is not null          then 'received'
    when t.today > lc.expected_on            then 'late'
    else 'at_lab'
  end as status,
  lc.received_on - lc.sent_on as turnaround_days,
  na.next_appointment_at,
  (lc.cancelled_at is null and lc.received_on is null
   and na.next_appointment_at is not null
   and (na.next_appointment_at at time zone c.timezone)::date <= t.today + 3) as at_risk
from public.lab_cases lc
join public.labs l     on l.id = lc.lab_id
join public.patients p on p.id = lc.patient_id
join public.clinics c  on c.id = lc.clinic_id
cross join lateral (select (now() at time zone c.timezone)::date as today) t
left join lateral (
  select min(a.starts_at) as next_appointment_at
  from public.appointments a
  where a.patient_id = lc.patient_id and a.status = 'booked' and a.starts_at > now()
) na on true;

-- ---------------------------------------------------------------------
-- 4. Medical history & consent forms
-- ---------------------------------------------------------------------
create table public.form_templates (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  kind        text not null check (kind in ('medical_history', 'consent')),
  title       text not null,
  version     smallint not null default 1,
  body        jsonb not null,               -- questions / consent text, rendered by the frontend
  active      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (clinic_id, kind, title, version),
  unique (id, clinic_id)
);

create table public.form_requests (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics(id) on delete cascade,
  patient_id         uuid not null,
  template_id        uuid not null,
  treatment_plan_id  uuid,
  token_hash         bytea not null unique,     -- sha256 of the link token; the token itself is never stored
  expires_at         timestamptz not null,
  completed_at       timestamptz,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  foreign key (patient_id,        clinic_id) references public.patients        (id, clinic_id),
  foreign key (template_id,       clinic_id) references public.form_templates  (id, clinic_id),
  foreign key (treatment_plan_id, clinic_id) references public.treatment_plans (id, clinic_id)
);

create table public.form_submissions (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics(id),
  patient_id         uuid not null,
  template_id        uuid not null,
  request_id         uuid unique references public.form_requests(id),
  treatment_plan_id  uuid,
  answers            jsonb not null,
  signed_by_name     text not null check (length(trim(signed_by_name)) > 0),
  signature_data     text not null check (length(signature_data) between 20 and 300000), -- PNG/SVG data URL
  signed_at          timestamptz not null default now(),
  foreign key (patient_id,        clinic_id) references public.patients        (id, clinic_id),
  foreign key (template_id,       clinic_id) references public.form_templates  (id, clinic_id),
  foreign key (treatment_plan_id, clinic_id) references public.treatment_plans (id, clinic_id)
);
create index form_submissions_patient_idx on public.form_submissions (patient_id, signed_at desc);

create trigger form_submissions_append_only
  before update or delete on public.form_submissions
  for each row execute function public.forbid_mutation();

-- A template's content is frozen once anyone has signed it: publish a new version instead.
create or replace function public.freeze_used_template()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.body is distinct from old.body or new.title is distinct from old.title
      or new.kind is distinct from old.kind or new.version is distinct from old.version)
     and exists (select 1 from public.form_submissions where template_id = old.id) then
    raise exception 'Template already signed by patients; create a new version instead';
  end if;
  return new;
end;
$$;

create trigger form_templates_freeze
  before update on public.form_templates
  for each row execute function public.freeze_used_template();

-- Staff: create a one-time link. Returns the token (shown once) to put in the URL.
create or replace function public.create_form_request(
  p_patient_id        uuid,
  p_template_id       uuid,
  p_treatment_plan_id uuid default null,
  p_valid_hours       int  default 72)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic uuid;
  v_token  text;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if not found then raise exception 'Patient not found'; end if;
  if not public.is_member(v_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.form_templates
                 where id = p_template_id and clinic_id = v_clinic and active) then
    raise exception 'Template not found or inactive';
  end if;
  if p_valid_hours not between 1 and 720 then raise exception 'Validity must be 1 to 720 hours'; end if;

  -- 244 random bits from two v4 UUIDs (gen_random_uuid uses a CSPRNG).
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.form_requests
    (clinic_id, patient_id, template_id, treatment_plan_id, token_hash, expires_at)
  values
    (v_clinic, p_patient_id, p_template_id, p_treatment_plan_id,
     sha256(convert_to(v_token, 'UTF8')), now() + make_interval(hours => p_valid_hours));

  return v_token;
end;
$$;

-- Patient (anonymous): load the form behind a link.
create or replace function public.get_form_by_token(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
           'clinic',             c.name,
           'patient_first_name', split_part(p.full_name, ' ', 1),
           'kind',               t.kind,
           'title',              t.title,
           'body',               t.body,
           'expires_at',         r.expires_at)
  into v
  from public.form_requests r
  join public.form_templates t on t.id = r.template_id
  join public.patients p       on p.id = r.patient_id
  join public.clinics c        on c.id = r.clinic_id
  where r.token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
    and r.completed_at is null
    and r.expires_at > now();

  if v is null then raise exception 'This link is invalid, expired, or already used'; end if;
  return v;
end;
$$;

-- Patient (anonymous): submit and sign. One submission per link.
create or replace function public.submit_form(
  p_token          text,
  p_answers        jsonb,
  p_signed_by_name text,
  p_signature_data text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.form_requests;
  v_id  uuid;
begin
  select * into v_req from public.form_requests
  where token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
  for update;

  if not found or v_req.completed_at is not null or v_req.expires_at <= now() then
    raise exception 'This link is invalid, expired, or already used';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers must be a JSON object';
  end if;

  insert into public.form_submissions
    (clinic_id, patient_id, template_id, request_id, treatment_plan_id, answers, signed_by_name, signature_data)
  values
    (v_req.clinic_id, v_req.patient_id, v_req.template_id, v_req.id, v_req.treatment_plan_id,
     p_answers, p_signed_by_name, p_signature_data)
  returning id into v_id;

  update public.form_requests set completed_at = now() where id = v_req.id;
  return v_id;
end;
$$;

-- Latest medical history per patient; flag it if older than 12 months.
create view public.latest_medical_history with (security_invoker = true) as
select distinct on (fs.patient_id)
  fs.patient_id,
  fs.clinic_id,
  fs.id           as submission_id,
  ft.title,
  ft.version,
  fs.answers,
  fs.signed_at,
  fs.signed_at < now() - interval '12 months' as needs_update
from public.form_submissions fs
join public.form_templates ft on ft.id = fs.template_id
where ft.kind = 'medical_history'
order by fs.patient_id, fs.signed_at desc;

-- One row per treatment plan, for the plan list screen.
create view public.treatment_plan_overview with (security_invoker = true) as
select
  tp.id            as treatment_plan_id,
  tp.clinic_id,
  tp.patient_id,
  p.full_name,
  tp.title,
  tp.status,
  public.plan_net_total(tp.id) as net_total,
  tp.presented_at,
  tp.accepted_at,
  tp.declined_at,
  tp.decline_reason,
  exists (
    select 1 from public.form_submissions fs
    join public.form_templates ft on ft.id = fs.template_id
    where fs.treatment_plan_id = tp.id and ft.kind = 'consent'
  ) as consent_signed
from public.treatment_plans tp
join public.patients p on p.id = tp.patient_id;

-- Case acceptance per month (by month presented, clinic timezone).
create view public.case_acceptance_monthly with (security_invoker = true) as
select
  tp.clinic_id,
  date_trunc('month', tp.presented_at at time zone c.timezone)::date   as month,
  count(*)                                                             as presented,
  count(*) filter (where tp.accepted_at is not null)                   as accepted,
  count(*) filter (where tp.declined_at is not null and tp.accepted_at is null) as declined,
  coalesce(sum(public.plan_net_total(tp.id)), 0)                       as presented_value,
  coalesce(sum(public.plan_net_total(tp.id)) filter (where tp.accepted_at is not null), 0) as accepted_value,
  round(100.0 * count(*) filter (where tp.accepted_at is not null) / nullif(count(*), 0), 1) as acceptance_rate_pct
from public.treatment_plans tp
join public.clinics c on c.id = tp.clinic_id
where tp.presented_at is not null
group by tp.clinic_id, 2;

-- Accepted treatment with work left to do and no upcoming appointment.
create view public.unscheduled_treatment with (security_invoker = true) as
select
  tp.id           as treatment_plan_id,
  tp.clinic_id,
  tp.patient_id,
  p.full_name,
  p.phone,
  tp.title,
  tp.accepted_at,
  sum(i.price)    as remaining_value,
  count(*)        as remaining_items,
  (select max(s.performed_at) from public.sessions s where s.treatment_plan_id = tp.id) as last_session_at
from public.treatment_plans tp
join public.patients p              on p.id = tp.patient_id
join public.treatment_plan_items i  on i.plan_id = tp.id and i.status = 'planned'
where tp.accepted_at is not null
  and tp.status::text = 'active'
  and not exists (
    select 1 from public.appointments a
    where a.patient_id = tp.patient_id and a.status = 'booked' and a.starts_at > now()
  )
group by tp.id, p.id;

-- ---------------------------------------------------------------------
-- 5. Installment agreements
-- ---------------------------------------------------------------------
create table public.installment_agreements (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references public.clinics(id),
  installment_plan_id  uuid not null,
  version              smallint not null,
  terms                jsonb not null,          -- full snapshot; the PDF is rendered from this
  document_path        text,                    -- rendered PDF in the patient-files bucket
  signed_by_name       text,
  signature_data       text check (signature_data is null or length(signature_data) between 20 and 300000),
  signed_at            timestamptz,
  created_at           timestamptz not null default now(),
  unique (installment_plan_id, version),
  check ((signed_at is null) = (signature_data is null)),
  foreign key (installment_plan_id, clinic_id) references public.installment_plans (id, clinic_id)
);

-- Terms are frozen; only the PDF path (once) and the signature (once) can be added.
create or replace function public.guard_installment_agreement()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'installment_agreements is append-only';
  end if;
  if new.terms is distinct from old.terms or new.version is distinct from old.version
     or new.installment_plan_id is distinct from old.installment_plan_id then
    raise exception 'Agreement terms cannot be changed';
  end if;
  if old.document_path is not null and new.document_path is distinct from old.document_path then
    raise exception 'Agreement document already attached';
  end if;
  if old.signed_at is not null and (new.signed_at is distinct from old.signed_at
       or new.signature_data is distinct from old.signature_data
       or new.signed_by_name is distinct from old.signed_by_name) then
    raise exception 'Agreement already signed';
  end if;
  return new;
end;
$$;

create trigger installment_agreements_guard
  before update or delete on public.installment_agreements
  for each row execute function public.guard_installment_agreement();

create or replace function public._snapshot_installment_agreement(p_installment_plan_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.installment_agreements (clinic_id, installment_plan_id, version, terms)
  select
    ip.clinic_id,
    ip.id,
    coalesce((select max(a.version) from public.installment_agreements a
              where a.installment_plan_id = ip.id), 0) + 1,
    jsonb_build_object(
      'clinic',        c.name,
      'currency',      c.currency,
      'patient',       jsonb_build_object('name', p.full_name, 'phone', p.phone),
      'treatment',     jsonb_build_object(
                         'title',    tp.title,
                         'discount', tp.discount,
                         'items',    (select coalesce(jsonb_agg(jsonb_build_object(
                                        'description', coalesce(i.description, pr.name),
                                        'tooth',       i.tooth_number,
                                        'price',       i.price) order by i.created_at), '[]'::jsonb)
                                      from public.treatment_plan_items i
                                      left join public.procedures pr on pr.id = i.procedure_id
                                      where i.plan_id = tp.id and i.status <> 'cancelled')),
      'net_total',     ip.net_total,
      'down_payment',  ip.down_payment,
      'paid_to_date',  (select coalesce(sum(s.paid), 0) from public.installment_status s
                        where s.installment_plan_id = ip.id),
      'schedule',      (select coalesce(jsonb_agg(jsonb_build_object(
                          'seq',          s.seq,
                          'down_payment', s.is_down_payment,
                          'due_date',     s.due_date,
                          'amount',       s.amount,
                          'paid',         s.paid) order by s.seq), '[]'::jsonb)
                        from public.installment_status s
                        where s.installment_plan_id = ip.id and s.status <> 'cancelled'),
      'rules',         jsonb_build_object(
                         'grace_days',                 c.grace_days,
                         'session_lock_after_overdue', c.lock_threshold,
                         'late_fees',                  false,
                         'installment_price_equals_cash', true),
      'reason',        p_reason,
      'generated_at',  now())
  from public.installment_plans ip
  join public.clinics c          on c.id  = ip.clinic_id
  join public.patients p         on p.id  = ip.patient_id
  join public.treatment_plans tp on tp.id = ip.treatment_plan_id
  where ip.id = p_installment_plan_id;
end;
$$;

-- Deferred to commit, so the snapshot sees the generated schedule and final totals.
create or replace function public._agreement_on_new_plan()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public._snapshot_installment_agreement(new.id, 'Initial agreement');
  return null;
end;
$$;

create or replace function public._agreement_on_revision()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public._snapshot_installment_agreement(new.installment_plan_id, new.reason);
  return null;
end;
$$;

create constraint trigger installment_plans_agreement
  after insert on public.installment_plans
  deferrable initially deferred
  for each row execute function public._agreement_on_new_plan();

create constraint trigger installment_revisions_agreement
  after insert on public.installment_plan_revisions
  deferrable initially deferred
  for each row execute function public._agreement_on_revision();

-- Backfill agreements for plans created before this migration.
do $$
declare r record;
begin
  for r in select ip.id from public.installment_plans ip
           where not exists (select 1 from public.installment_agreements a where a.installment_plan_id = ip.id)
  loop
    perform public._snapshot_installment_agreement(r.id, 'Initial agreement (backfilled)');
  end loop;
end $$;

create or replace function public.sign_installment_agreement(
  p_agreement_id   uuid,
  p_signed_by_name text,
  p_signature_data text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_a public.installment_agreements;
begin
  select * into v_a from public.installment_agreements where id = p_agreement_id for update;
  if not found then raise exception 'Agreement not found'; end if;
  if not public.is_member(v_a.clinic_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if v_a.version <> (select max(version) from public.installment_agreements
                     where installment_plan_id = v_a.installment_plan_id) then
    raise exception 'Only the latest version of the agreement can be signed';
  end if;
  if length(trim(coalesce(p_signed_by_name, ''))) = 0 then raise exception 'Signer name is required'; end if;

  update public.installment_agreements
  set signed_by_name = p_signed_by_name, signature_data = p_signature_data, signed_at = now()
  where id = v_a.id;
end;
$$;

create or replace function public.attach_agreement_document(p_agreement_id uuid, p_document_path text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic uuid;
begin
  select clinic_id into v_clinic from public.installment_agreements where id = p_agreement_id;
  if not found then raise exception 'Agreement not found'; end if;
  if not public.is_member(v_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.installment_agreements set document_path = p_document_path where id = p_agreement_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.labs                   enable row level security;
alter table public.lab_cases              enable row level security;
alter table public.form_templates         enable row level security;
alter table public.form_requests          enable row level security;
alter table public.form_submissions       enable row level security;
alter table public.installment_agreements enable row level security;

create policy labs_select on public.labs for select to authenticated using (public.is_member(clinic_id));
create policy labs_insert on public.labs for insert to authenticated with check (public.is_member(clinic_id));
create policy labs_update on public.labs for update to authenticated
  using (public.is_member(clinic_id)) with check (public.is_member(clinic_id));

create policy lab_cases_select on public.lab_cases for select to authenticated using (public.is_member(clinic_id));
create policy lab_cases_insert on public.lab_cases for insert to authenticated with check (public.is_member(clinic_id));
create policy lab_cases_update on public.lab_cases for update to authenticated
  using (public.is_member(clinic_id)) with check (public.is_member(clinic_id));
create policy lab_cases_delete on public.lab_cases for delete to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]));

-- Templates: everyone reads, doctors write (clinical content).
create policy form_templates_select on public.form_templates for select to authenticated
  using (public.is_member(clinic_id));
create policy form_templates_insert on public.form_templates for insert to authenticated
  with check (public.is_doctor(clinic_id));
create policy form_templates_update on public.form_templates for update to authenticated
  using (public.is_doctor(clinic_id)) with check (public.is_doctor(clinic_id));

-- Requests, submissions, agreements: read-only for members; writes via RPCs.
create policy form_requests_select on public.form_requests for select to authenticated
  using (public.is_member(clinic_id));
create policy form_submissions_select on public.form_submissions for select to authenticated
  using (public.is_member(clinic_id));
create policy installment_agreements_select on public.installment_agreements for select to authenticated
  using (public.is_member(clinic_id));

-- ---------------------------------------------------------------------
-- Grants (Supabase default privileges re-grant new objects to anon, so repeat)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;

revoke insert, update, delete on public.form_requests, public.form_submissions,
  public.installment_agreements from authenticated;
revoke delete on public.form_templates from authenticated;

grant select on public.treatment_plan_overview, public.case_acceptance_monthly,
  public.unscheduled_treatment, public.recall_list, public.lab_case_status,
  public.latest_medical_history to authenticated;

revoke execute on function public._snapshot_installment_agreement(uuid, text) from authenticated;
revoke execute on function public._agreement_on_new_plan()                 from authenticated;
revoke execute on function public._agreement_on_revision()                 from authenticated;

grant execute on function
  public.create_installment_plan(uuid, numeric, int, date),
  public.cancel_installment_plan(uuid, text),
  public.create_form_request(uuid, uuid, uuid, int),
  public.sign_installment_agreement(uuid, text, text),
  public.attach_agreement_document(uuid, text)
to authenticated;

-- The only things an anonymous visitor (the patient's link) can do.
grant execute on function
  public.get_form_by_token(text),
  public.submit_form(text, jsonb, text, text)
to anon, authenticated;
