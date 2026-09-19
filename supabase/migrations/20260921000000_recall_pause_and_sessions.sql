-- =====================================================================
-- Dental Clinic System — migration 0003
-- Requires: 0001, 0002
--
-- 1. Recall pauses while the patient has an active treatment plan
--    (clinic rule: don't chase patients who are mid-treatment).
-- 2. When a treatment plan is completed, the recall clock restarts
--    from the completion date.
-- 3. record_session(): saves a session and marks finished items in one
--    transaction (replaces the two-step insert + update from the app).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Recall list excludes patients in active treatment
-- ---------------------------------------------------------------------
create or replace view public.recall_list with (security_invoker = true) as
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
  and p.next_recall_due <= t.today + 30
  and not exists (
    select 1 from public.treatment_plans tp
    where tp.patient_id = p.id and tp.status::text = 'active'
  );

-- ---------------------------------------------------------------------
-- 2. Completing a plan restarts the recall clock
-- ---------------------------------------------------------------------
create or replace function public.restart_recall_on_completion()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.status::text = 'completed' and old.status::text <> 'completed' then
    update public.patients p
    set next_recall_due = (public.clinic_today(p.clinic_id)
                           + make_interval(months => p.recall_interval_months))::date
    where p.id = new.patient_id
      and p.recall_interval_months is not null;
  end if;
  return null;
end;
$$;

create trigger treatment_plans_restart_recall
  after update of status on public.treatment_plans
  for each row execute function public.restart_recall_on_completion();

-- ---------------------------------------------------------------------
-- 3. Atomic session recording
-- ---------------------------------------------------------------------
-- Inserting into sessions still fires the lock check (enforce_session_lock),
-- so a locked plan raises SESSION_LOCKED unless a doctor gives a reason.
create or replace function public.record_session(
  p_patient_id        uuid,
  p_notes             text,
  p_is_recall_visit   boolean,
  p_treatment_plan_id uuid    default null,
  p_done_item_ids     uuid[]  default '{}',
  p_override_reason   text    default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic  uuid;
  v_id      uuid;
  v_marked  int;
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

  insert into public.sessions
    (clinic_id, patient_id, treatment_plan_id, notes, is_recall_visit, lock_override, override_reason)
  values
    (v_clinic, p_patient_id, p_treatment_plan_id, nullif(trim(p_notes), ''), coalesce(p_is_recall_visit, false),
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

revoke execute on function public.record_session(uuid, text, boolean, uuid, uuid[], text) from public, anon;
grant  execute on function public.record_session(uuid, text, boolean, uuid, uuid[], text) to authenticated;
revoke execute on function public.restart_recall_on_completion() from public, anon, authenticated;
