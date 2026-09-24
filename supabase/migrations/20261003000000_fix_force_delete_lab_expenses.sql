-- =====================================================================
-- Dental Clinic System — migration 0015: force delete vs lab expenses
-- Requires: 0001–0014
--
-- Deleting a patient failed when they had lab work with a fee, because the
-- lab expense points at the lab case. The money was really paid to the lab,
-- so the expense must survive: it is detached from the lab case instead of
-- being deleted, keeping the clinic's expense history intact.
-- =====================================================================

-- The expense guard needs the same narrow, transaction-local exemption the
-- other append-only guards got, so the purge can detach the row.
create or replace function public.guard_expense()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.purging_patient', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then raise exception 'expenses are never deleted; void them instead'; end if;
  if old.voided_at is not null then raise exception 'This expense is already voided'; end if;
  if (new.amount, new.spent_on, new.category, new.clinic_id)
     is distinct from (old.amount, old.spent_on, old.category, old.clinic_id)
     and old.lab_case_id is null then
    raise exception 'Void this expense and enter a new one instead of editing it';
  end if;
  return new;
end;
$$;

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

  select coalesce(array_agg(storage_path), '{}') into v_paths
  from public.patient_files where patient_id = p_patient;

  insert into public.deleted_patients (clinic_id, full_name, phone, counts, reason)
  values (v_clinic, v_name, v_phone, v_counts, nullif(trim(p_reason), ''));

  perform set_config('app.purging_patient', 'on', true);   -- transaction-local

  -- Lab fees are money the clinic paid out: keep the expense, drop the link,
  -- and note where it came from so the line still makes sense in the report.
  update public.expenses e
  set lab_case_id = null,
      note = trim(both ' ' from coalesce(e.note, '') || ' (' || v_name || ')')
  where e.lab_case_id in (select id from public.lab_cases where patient_id = p_patient);

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

grant execute on function public.delete_patient(uuid, boolean, text) to authenticated;
