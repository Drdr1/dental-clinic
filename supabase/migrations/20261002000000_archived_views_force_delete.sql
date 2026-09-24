-- =====================================================================
-- Dental Clinic System — migration 0014: archived patients & owner delete
-- Requires: 0001–0013
--
--   * archived patients disappear from the Today screen and every list
--   * the owner can force-delete a patient WITH records (a written reason
--     is required, and a summary is kept in deleted_patients forever)
--   * deleting returns the storage paths so the app can remove the files
--
-- Note: force-deleting a patient who had payments changes past income
-- figures. Cash closings already recorded are snapshots and do not move,
-- so old closings and new reports can disagree. Archive is the safe choice.
-- =====================================================================

-- recall_list: archived patients drop out of the Today screen and every list
create or replace view public.recall_list with (security_invoker = true) as
SELECT p.id AS patient_id,
    p.clinic_id,
    p.full_name,
    p.phone,
    COALESCE(p.whatsapp_phone, p.phone) AS whatsapp_phone,
    p.recall_type,
    p.next_recall_due,
        CASE
            WHEN p.next_recall_due < t.today THEN 'overdue'::text
            WHEN p.next_recall_due = t.today THEN 'due'::text
            ELSE 'due_soon'::text
        END AS status,
    GREATEST(t.today - p.next_recall_due, 0) AS days_overdue,
    (EXISTS ( SELECT 1
           FROM appointments a
          WHERE a.patient_id = p.id AND a.status = 'booked'::appointment_status AND a.starts_at > now())) AS has_upcoming_appointment
   FROM patients p
     JOIN clinics c ON c.id = p.clinic_id
     CROSS JOIN LATERAL ( SELECT (now() AT TIME ZONE c.timezone)::date AS today) t
  WHERE p.recall_interval_months IS NOT NULL AND p.next_recall_due IS NOT NULL AND p.next_recall_due <= (t.today + 30) AND NOT (EXISTS ( SELECT 1
           FROM treatment_plans tp
          WHERE tp.patient_id = p.id AND tp.status::text = 'active'::text))
    and p.archived_at is null;

-- unscheduled_treatment: archived patients drop out of the Today screen and every list
create or replace view public.unscheduled_treatment with (security_invoker = true) as
SELECT tp.id AS treatment_plan_id,
    tp.clinic_id,
    tp.patient_id,
    p.full_name,
    p.phone,
    tp.title,
    tp.accepted_at,
    sum(i.price) AS remaining_value,
    count(*) AS remaining_items,
    ( SELECT max(s.performed_at) AS max
           FROM sessions s
          WHERE s.treatment_plan_id = tp.id) AS last_session_at
   FROM treatment_plans tp
     JOIN patients p ON p.id = tp.patient_id
     JOIN treatment_plan_items i ON i.plan_id = tp.id AND i.status = 'planned'::plan_item_status
  WHERE tp.accepted_at IS NOT NULL AND tp.status::text = 'active'::text AND NOT (EXISTS ( SELECT 1
           FROM appointments a
          WHERE a.patient_id = tp.patient_id AND a.status = 'booked'::appointment_status AND a.starts_at > now()))
    and not exists (select 1 from public.patients ap where ap.id = tp.patient_id and ap.archived_at is not null)
  GROUP BY tp.id, p.id;

-- installment_agenda: archived patients drop out of the Today screen and every list
create or replace view public.installment_agenda with (security_invoker = true) as
SELECT s.id,
    s.clinic_id,
    s.installment_plan_id,
    s.patient_id,
    s.treatment_plan_id,
    s.seq,
    s.is_down_payment,
    s.due_date,
    s.grace_end,
    s.amount,
    s.paid,
    s.remaining,
    s.last_paid_at,
    s.is_partial,
    s.status,
    s.days_overdue,
    p.full_name,
    p.phone,
    COALESCE(p.whatsapp_phone, p.phone) AS whatsapp_phone
   FROM installment_status s
     JOIN patients p ON p.id = s.patient_id
     JOIN clinics c ON c.id = s.clinic_id
  where ((s.status = ANY (ARRAY['overdue'::text, 'in_grace'::text, 'due'::text])) OR s.status = 'upcoming'::text AND s.due_date <= ((now() AT TIME ZONE c.timezone)::date + 7))
    and p.archived_at is null;

-- lab_case_status: archived patients drop out of the Today screen and every list
create or replace view public.lab_case_status with (security_invoker = true) as
SELECT lc.id,
    lc.clinic_id,
    lc.patient_id,
    lc.plan_item_id,
    lc.lab_id,
    lc.description,
    lc.shade,
    lc.lab_fee,
    lc.sent_on,
    lc.expected_on,
    lc.received_on,
    lc.fitted_on,
    lc.cancelled_at,
    lc.notes,
    lc.created_by,
    lc.created_at,
    l.name AS lab_name,
    p.full_name,
        CASE
            WHEN lc.cancelled_at IS NOT NULL THEN 'cancelled'::text
            WHEN lc.fitted_on IS NOT NULL THEN 'fitted'::text
            WHEN lc.received_on IS NOT NULL THEN 'received'::text
            WHEN t.today > lc.expected_on THEN 'late'::text
            ELSE 'at_lab'::text
        END AS status,
    lc.received_on - lc.sent_on AS turnaround_days,
    na.next_appointment_at,
    lc.cancelled_at IS NULL AND lc.received_on IS NULL AND na.next_appointment_at IS NOT NULL AND (na.next_appointment_at AT TIME ZONE c.timezone)::date <= (t.today + 3) AS at_risk
   FROM lab_cases lc
     JOIN labs l ON l.id = lc.lab_id
     JOIN patients p ON p.id = lc.patient_id
     JOIN clinics c ON c.id = lc.clinic_id
     CROSS JOIN LATERAL ( SELECT (now() AT TIME ZONE c.timezone)::date AS today) t
     LEFT JOIN LATERAL ( SELECT min(a.starts_at) AS next_appointment_at
           FROM appointments a
          WHERE a.patient_id = lc.patient_id AND a.status = 'booked'::appointment_status AND a.starts_at > now()) na ON true
  where not exists (select 1 from public.patients ap where ap.id = lc.patient_id and ap.archived_at is not null);

-- ---------------------------------------------------------------------
-- What was deleted, and why. Append-only, survives the patient.
-- ---------------------------------------------------------------------
create table public.deleted_patients (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id),
  full_name    text not null,
  phone        text,
  counts       jsonb not null,
  reason       text,
  deleted_by   uuid not null default auth.uid(),
  deleted_at   timestamptz not null default now()
);

create trigger deleted_patients_append_only
  before update or delete on public.deleted_patients
  for each row execute function public.forbid_mutation();

alter table public.deleted_patients enable row level security;
create policy deleted_patients_select on public.deleted_patients for select to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]));


-- ---------------------------------------------------------------------
-- The append-only guards must not be bypassable by ordinary users, but the
-- owner's purge has to get through. The guard now yields only while the
-- transaction-local flag below is set, which only delete_patient() sets.
-- Direct deletes stay impossible anyway: no DELETE policy exists on these
-- tables for authenticated users, so RLS refuses before the trigger runs.
-- ---------------------------------------------------------------------
create or replace function public.forbid_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.purging_patient', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  raise exception '% is append-only; use the proper correction function instead', tg_table_name;
end;
$$;


-- The signed-agreement guard needs the same narrow exemption.
create or replace function public.guard_installment_agreement()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.purging_patient', true), '') = 'on' then
    return coalesce(new, old);
  end if;
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

-- ---------------------------------------------------------------------
-- Delete. Without p_force, only a patient with nothing attached.
-- With p_force (owner + reason), everything of theirs goes.
-- ---------------------------------------------------------------------
create or replace function public.delete_patient(
  p_patient uuid,
  p_force   boolean default false,
  p_reason  text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic   uuid;
  v_name     text;
  v_phone    text;
  v_counts   jsonb;
  v_blockers text;
  v_paths    text[];
begin
  select clinic_id, full_name, phone into v_clinic, v_name, v_phone
  from public.patients where id = p_patient;
  if not found then raise exception 'Patient not found'; end if;
  if not public.has_role(v_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can delete a patient' using errcode = '42501';
  end if;

  v_counts := public.patient_record_counts(p_patient);

  select string_agg(key || '=' || value, ', ') into v_blockers
  from jsonb_each_text(v_counts) where key <> 'appointments' and value <> '0';

  if v_blockers is not null and not p_force then
    raise exception 'HAS_RECORDS: %', v_blockers;
  end if;
  if p_force and length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'REASON_REQUIRED';
  end if;

  -- Files live in object storage; hand their paths back so the app removes them.
  select coalesce(array_agg(storage_path), '{}') into v_paths
  from public.patient_files where patient_id = p_patient;

  insert into public.deleted_patients (clinic_id, full_name, phone, counts, reason)
  values (v_clinic, v_name, v_phone, v_counts, nullif(trim(p_reason), ''));

  -- Children first, deepest first. Money rows are append-only for staff,
  -- so this function (security definer) is the only way they can ever go.
  perform set_config('app.purging_patient', 'on', true);   -- transaction-local
  delete from public.payment_allocations pa using public.payments p
    where pa.payment_id = p.id and p.patient_id = p_patient;
  delete from public.payments             where patient_id = p_patient;
  delete from public.installments         where installment_plan_id in
    (select id from public.installment_plans where patient_id = p_patient);
  delete from public.installment_agreements where installment_plan_id in
    (select id from public.installment_plans where patient_id = p_patient);
  delete from public.installment_plan_revisions where installment_plan_id in
    (select id from public.installment_plans where patient_id = p_patient);
  delete from public.installment_plans    where patient_id = p_patient;
  delete from public.prescription_items   where prescription_id in
    (select id from public.prescriptions where patient_id = p_patient);
  delete from public.prescriptions        where patient_id = p_patient;
  delete from public.lab_cases            where patient_id = p_patient;
  delete from public.form_submissions     where patient_id = p_patient;
  delete from public.form_requests        where patient_id = p_patient;
  delete from public.patient_files        where patient_id = p_patient;
  update public.treatment_plan_items set done_in_session_id = null
    where plan_id in (select id from public.treatment_plans where patient_id = p_patient);
  delete from public.sessions             where patient_id = p_patient;
  delete from public.treatment_plan_items where plan_id in
    (select id from public.treatment_plans where patient_id = p_patient);
  delete from public.appointments         where patient_id = p_patient;
  delete from public.treatment_plans      where patient_id = p_patient;
  delete from public.patients             where id = p_patient;

  perform set_config('app.purging_patient', 'off', true);
  return jsonb_build_object('deleted', true, 'storage_paths', to_jsonb(v_paths), 'counts', v_counts);
end;
$$;

revoke execute on function public.delete_patient(uuid) from authenticated;
drop function if exists public.delete_patient(uuid);
grant execute on function public.delete_patient(uuid, boolean, text) to authenticated;
grant select on public.deleted_patients to authenticated;

-- ---------------------------------------------------------------------
-- Clinic logo, shown in the app and printed on receipts, prescriptions
-- and agreements. Stored inline (small PNG data URL) so printing needs
-- no extra request and no public bucket.
-- ---------------------------------------------------------------------
alter table public.clinics
  add column logo_url text
  check (logo_url is null or (logo_url like 'data:image/%' and length(logo_url) < 400000));

grant update (logo_url) on public.clinics to authenticated;
