-- =====================================================================
-- Dental Clinic System — migration 0013: archive / delete patients
-- Requires: 0001–0012
--
-- Two different needs, two different actions:
--   archive_patient()  – hide from lists, keep every record. Reversible.
--   delete_patient()   – owner only, and only when NOTHING is attached:
--                        no sessions, payments, plans, prescriptions,
--                        files, forms or lab work. For test entries and
--                        mistaken bookings, never for real history.
-- =====================================================================

alter table public.patients
  add column archived_at     timestamptz,
  add column archive_reason  text;

create index patients_active_idx on public.patients (clinic_id, full_name) where archived_at is null;

create or replace function public.archive_patient(p_patient uuid, p_reason text default null, p_archive boolean default true)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_clinic uuid;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient;
  if not found then raise exception 'Patient not found'; end if;
  if not public.is_member(v_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;

  if p_archive then
    -- Free the calendar: drop future appointments that would otherwise sit there.
    update public.appointments set status = 'cancelled'
    where patient_id = p_patient and starts_at > now() and status in ('booked', 'arrived');

    update public.patients
    set archived_at = now(), archive_reason = nullif(trim(p_reason), ''), next_recall_due = null
    where id = p_patient;
  else
    update public.patients set archived_at = null, archive_reason = null where id = p_patient;
  end if;
end;
$$;

-- What is attached to this patient — the app shows this before offering delete.
create or replace function public.patient_record_counts(p_patient uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_clinic uuid; v jsonb;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient;
  if not found then raise exception 'Patient not found'; end if;
  if not public.is_member(v_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;

  select jsonb_build_object(
    'sessions',      (select count(*) from public.sessions           where patient_id = p_patient),
    'payments',      (select count(*) from public.payments           where patient_id = p_patient),
    'plans',         (select count(*) from public.treatment_plans    where patient_id = p_patient),
    'prescriptions', (select count(*) from public.prescriptions      where patient_id = p_patient),
    'files',         (select count(*) from public.patient_files      where patient_id = p_patient),
    'forms',         (select count(*) from public.form_submissions   where patient_id = p_patient),
    'lab_cases',     (select count(*) from public.lab_cases          where patient_id = p_patient),
    'appointments',  (select count(*) from public.appointments       where patient_id = p_patient)
  ) into v;
  return v;
end;
$$;

-- Owner only, and only for a patient with no clinical or financial history.
-- Appointments and pending form links are cleared with them; anything else blocks.
create or replace function public.delete_patient(p_patient uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic uuid;
  v_counts jsonb;
  v_blockers text;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient;
  if not found then raise exception 'Patient not found'; end if;
  if not public.has_role(v_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can delete a patient' using errcode = '42501';
  end if;

  v_counts := public.patient_record_counts(p_patient);

  select string_agg(key || '=' || value, ', ')
  into v_blockers
  from jsonb_each_text(v_counts)
  where key <> 'appointments' and value <> '0';

  if v_blockers is not null then
    raise exception 'HAS_RECORDS: %', v_blockers;
  end if;

  delete from public.form_requests where patient_id = p_patient;
  delete from public.appointments  where patient_id = p_patient;
  delete from public.patients      where id = p_patient;
end;
$$;

grant execute on function
  public.archive_patient(uuid, text, boolean),
  public.patient_record_counts(uuid),
  public.delete_patient(uuid)
to authenticated;

revoke all on all functions in schema public from public, anon;
grant execute on function public.get_form_by_token(text), public.submit_form(text, jsonb, text, text) to anon;
grant execute on function
  public.booking_clinic(text),
  public.booking_slots(text, date, uuid),
  public.book_appointment(text, uuid, timestamptz, text, text, text)
to anon, authenticated;
