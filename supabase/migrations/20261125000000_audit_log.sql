-- =====================================================================
-- Audit log: who changed what, and when. Append-only — nobody can edit
-- or delete a row, the owner included. Only the owner can read it.
--
-- Rows are written by triggers on the tables below, so every path that
-- changes data (screens, RPCs, the assistant) is covered the same way.
-- The UI builds the sentence from `action` + `data`.
-- =====================================================================

create table public.audit_log (
  id          bigint generated always as identity primary key,
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_name  text,
  actor_role  public.member_role,
  category    text not null check (category in ('money', 'appointments', 'patients', 'plans', 'team')),
  action      text not null,
  sensitive   boolean not null default false,
  patient_id  uuid,
  patient_name text,
  data        jsonb not null default '{}'::jsonb
);
create index audit_log_clinic_at_idx on public.audit_log (clinic_id, at desc);
create index audit_log_clinic_actor_idx on public.audit_log (clinic_id, actor, at desc);

alter table public.audit_log enable row level security;
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]));
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- No edits, no deletes. Removing the whole clinic is the one exception.
create or replace function public.audit_log_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.clinics where id = old.clinic_id) then
    return old;
  end if;
  raise exception 'The audit log cannot be changed' using errcode = '42501';
end;
$$;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();

-- Writes one row; fills in who did it and the patient's name.
create or replace function public._audit(
  p_clinic uuid, p_category text, p_action text, p_sensitive boolean,
  p_patient uuid, p_data jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_role public.member_role;
  v_pname text;
begin
  if v_uid is not null then
    select display_name, role into v_name, v_role
    from public.clinic_members where clinic_id = p_clinic and user_id = v_uid;
  end if;
  if p_patient is not null then
    select full_name into v_pname from public.patients where id = p_patient;
  end if;
  insert into public.audit_log (clinic_id, actor, actor_name, actor_role, category, action, sensitive, patient_id, patient_name, data)
  values (p_clinic, v_uid, v_name, v_role, p_category, p_action, p_sensitive, p_patient, v_pname,
          jsonb_strip_nulls(coalesce(p_data, '{}'::jsonb)));
end;
$$;
revoke all on function public._audit(uuid, text, text, boolean, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------
create or replace function public.audit_payments() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.reverses_payment_id is not null then
    perform public._audit(new.clinic_id, 'money', 'payment.reverse', true, new.patient_id, jsonb_build_object(
      'amount', abs(new.amount), 'reason', new.note,
      'receipt_no', (select receipt_no from public.payments where id = new.reverses_payment_id)));
  else
    perform public._audit(new.clinic_id, 'money', 'payment.add', false, new.patient_id, jsonb_build_object(
      'amount', new.amount, 'method', new.method, 'receipt_no', new.receipt_no,
      'installment', new.installment_plan_id is not null));
  end if;
  return null;
end;
$$;
create trigger audit_payments after insert on public.payments
  for each row execute function public.audit_payments();

create or replace function public.audit_expenses() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    -- Lab fees and doctor payouts are written by the system; their own rows say enough.
    if new.lab_case_id is null and new.material_movement_id is null then
      perform public._audit(new.clinic_id, 'money', 'expense.add', false, null, jsonb_build_object(
        'amount', new.amount, 'category', new.category, 'note', coalesce(nullif(new.note, ''), new.paid_to)));
    end if;
  elsif old.voided_at is null and new.voided_at is not null then
    perform public._audit(new.clinic_id, 'money', 'expense.void', true, null, jsonb_build_object(
      'amount', new.amount, 'category', new.category, 'reason', new.void_reason));
  end if;
  return null;
end;
$$;
create trigger audit_expenses after insert or update on public.expenses
  for each row execute function public.audit_expenses();

create or replace function public.audit_cash_closings() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._audit(new.clinic_id, 'money', 'cash.close', new.difference <> 0, null, jsonb_build_object(
    'day', new.business_date, 'expected', new.expected_cash, 'counted', new.counted_cash,
    'difference', new.difference, 'reason', new.reason));
  return null;
end;
$$;
create trigger audit_cash_closings after insert on public.cash_closings
  for each row execute function public.audit_cash_closings();

-- ---------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------
create or replace function public.audit_appointments() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.clinics where id = old.clinic_id)
       or current_setting('dentano.purging_patient', true) = 'on' then return null; end if;
    perform public._audit(old.clinic_id, 'appointments', 'appt.delete', true, old.patient_id, jsonb_build_object(
      'at', old.starts_at, 'chair', (select name from public.chairs where id = old.chair_id),
      'doctor', (select display_name from public.clinic_members where clinic_id = old.clinic_id and user_id = old.doctor_id)));
    return null;
  end if;
  if new.status is distinct from old.status then
    perform public._audit(new.clinic_id, 'appointments', 'appt.status', false, new.patient_id, jsonb_build_object(
      'from', old.status, 'to', new.status, 'at', new.starts_at));
  end if;
  if new.starts_at is distinct from old.starts_at or new.chair_id is distinct from old.chair_id then
    perform public._audit(new.clinic_id, 'appointments', 'appt.move', false, new.patient_id, jsonb_build_object(
      'from', old.starts_at, 'to', new.starts_at,
      'chair', case when new.chair_id is distinct from old.chair_id then (select name from public.chairs where id = new.chair_id) end));
  end if;
  return null;
end;
$$;
create trigger audit_appointments after update or delete on public.appointments
  for each row execute function public.audit_appointments();

-- ---------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------
create or replace function public.audit_patients() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.full_name is distinct from old.full_name then
    perform public._audit(new.clinic_id, 'patients', 'patient.name', false, new.id,
      jsonb_build_object('from', old.full_name, 'to', new.full_name));
  end if;
  if new.phone is distinct from old.phone then
    perform public._audit(new.clinic_id, 'patients', 'patient.phone', false, new.id,
      jsonb_build_object('from', old.phone, 'to', new.phone));
  end if;
  if old.archived_at is null and new.archived_at is not null then
    perform public._audit(new.clinic_id, 'patients', 'patient.archive', true, new.id,
      jsonb_build_object('reason', new.archive_reason));
  elsif old.archived_at is not null and new.archived_at is null then
    perform public._audit(new.clinic_id, 'patients', 'patient.unarchive', false, new.id, '{}'::jsonb);
  end if;
  return null;
end;
$$;
create trigger audit_patients after update on public.patients
  for each row execute function public.audit_patients();

create or replace function public.audit_deleted_patients() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._audit(new.clinic_id, 'patients', 'patient.delete', true, null, jsonb_build_object(
    'name', new.full_name, 'phone', new.phone, 'reason', new.reason));
  -- The patient's appointments are removed next, in the same transaction; this
  -- one row already says it, so they are not logged one by one.
  perform set_config('dentano.purging_patient', 'on', true);
  return null;
end;
$$;
create trigger audit_deleted_patients after insert on public.deleted_patients
  for each row execute function public.audit_deleted_patients();

-- ---------------------------------------------------------------------
-- Plans and prices
-- ---------------------------------------------------------------------
create or replace function public.audit_plan_items() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare tp public.treatment_plans;
begin
  if new.price is distinct from old.price then
    select * into tp from public.treatment_plans where id = new.plan_id;
    perform public._audit(new.clinic_id, 'plans', 'item.price', true, tp.patient_id, jsonb_build_object(
      'item', coalesce(nullif(new.description, ''), (select name from public.procedures where id = new.procedure_id)),
      'plan', tp.title, 'plan_id', tp.id, 'from', old.price, 'to', new.price));
  end if;
  return null;
end;
$$;
create trigger audit_plan_items after update of price on public.treatment_plan_items
  for each row execute function public.audit_plan_items();

create or replace function public.audit_plans() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total numeric;
begin
  if new.discount is distinct from old.discount then
    v_total := public.plan_net_total(new.id);
    perform public._audit(new.clinic_id, 'plans', 'plan.discount', true, new.patient_id, jsonb_build_object(
      'plan', new.title, 'plan_id', new.id, 'from', old.discount, 'to', new.discount,
      'total', v_total, 'total_before', v_total + new.discount - old.discount));
  end if;
  if new.status is distinct from old.status and new.status <> 'draft' then
    perform public._audit(new.clinic_id, 'plans', 'plan.status', new.status = 'cancelled', new.patient_id, jsonb_build_object(
      'plan', new.title, 'plan_id', new.id, 'from', old.status, 'to', new.status, 'reason', new.decline_reason));
  end if;
  return null;
end;
$$;
create trigger audit_plans after update on public.treatment_plans
  for each row execute function public.audit_plans();

create or replace function public.audit_procedures() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.default_price is distinct from old.default_price then
    perform public._audit(new.clinic_id, 'plans', 'procedure.price', true, null, jsonb_build_object(
      'name', new.name, 'from', old.default_price, 'to', new.default_price));
  end if;
  return null;
end;
$$;
create trigger audit_procedures after update of default_price on public.procedures
  for each row execute function public.audit_procedures();

-- ---------------------------------------------------------------------
-- Team
-- ---------------------------------------------------------------------
create or replace function public.audit_members() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public._audit(new.clinic_id, 'team', 'member.add', false, null, jsonb_build_object(
      'name', new.display_name, 'role', new.role, 'percent', nullif(new.commission_percent, 0)));
    return null;
  end if;
  if new.role is distinct from old.role then
    perform public._audit(new.clinic_id, 'team', 'member.role', true, null, jsonb_build_object(
      'name', new.display_name, 'from', old.role, 'to', new.role));
  end if;
  if new.active is distinct from old.active then
    perform public._audit(new.clinic_id, 'team', case when new.active then 'member.on' else 'member.off' end, not new.active, null,
      jsonb_build_object('name', new.display_name));
  end if;
  if new.commission_percent is distinct from old.commission_percent then
    perform public._audit(new.clinic_id, 'team', 'member.percent', true, null, jsonb_build_object(
      'name', new.display_name, 'from', old.commission_percent, 'to', new.commission_percent));
  end if;
  return null;
end;
$$;
create trigger audit_members after insert or update on public.clinic_members
  for each row execute function public.audit_members();

-- The side card: this week's totals per person (owner only).
create or replace function public.audit_week(p_clinic uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_tz text; v_from timestamptz;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see this' using errcode = '42501';
  end if;
  select timezone into v_tz from public.clinics where id = p_clinic;
  -- The week starts on Saturday.
  v_from := ((now() at time zone v_tz)::date - ((extract(dow from (now() at time zone v_tz))::int + 1) % 7))::timestamp at time zone v_tz;
  return jsonb_build_object(
    'total', (select count(*) from public.audit_log where clinic_id = p_clinic and at >= v_from),
    'sensitive', (select count(*) from public.audit_log where clinic_id = p_clinic and at >= v_from and sensitive),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('actor', x.actor, 'name', x.name, 'n', x.n, 'sensitive', x.s) order by x.n desc)
      from (
        select a.actor, coalesce(max(a.actor_name), '') as name, count(*) as n, count(*) filter (where a.sensitive) as s
        from public.audit_log a where a.clinic_id = p_clinic and a.at >= v_from
        group by a.actor
      ) x), '[]'::jsonb));
end;
$$;
revoke all on function public.audit_week(uuid) from public, anon;
grant execute on function public.audit_week(uuid) to authenticated;
