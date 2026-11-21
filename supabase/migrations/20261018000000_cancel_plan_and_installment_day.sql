-- =====================================================================
-- Dental Clinic System — migration 0030: cancelling a treatment plan,
-- and instalments that always fall on the same day of the month.
-- Requires: 0001–0029
--
-- Cancelling used to be impossible from the desk: the status guard
-- refuses to cancel a plan while its instalment schedule is active, and
-- cancelling the schedule was doctor-only. Reception was left with a
-- wrong plan it could not retire.
--
-- Now one call does the whole thing, with the line drawn where it
-- belongs: anyone may cancel a plan nobody has paid into; once money
-- has been taken against it, only a doctor or the owner may.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cancelling a plan, schedule and all
-- ---------------------------------------------------------------------
create or replace function public.cancel_treatment_plan(p_plan uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.treatment_plans;
  v_paid numeric(12,2);
begin
  select * into v_plan from public.treatment_plans where id = p_plan for update;
  if not found then raise exception 'Treatment plan not found'; end if;
  if not public.is_member(v_plan.clinic_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required';
  end if;
  if v_plan.status::text in ('cancelled', 'completed') then
    raise exception 'Treatment plan is %', v_plan.status;
  end if;

  -- Reversals are negative rows, so this is what the patient is really out.
  select coalesce(sum(p.amount), 0) into v_paid
  from public.payments p where p.treatment_plan_id = p_plan;

  if v_paid > 0 and not public.is_doctor(v_plan.clinic_id) then
    raise exception 'This plan has payments on it; only a doctor or the owner can cancel it'
      using errcode = '42501';
  end if;

  -- The schedule first: the status guard refuses to cancel a plan under
  -- an active one. The money already taken stays on the patient's record.
  update public.installment_plans
  set status = 'cancelled', cancelled_at = now(),
      cancel_reason = coalesce(cancel_reason, p_reason)
  where treatment_plan_id = p_plan and status = 'active';

  update public.treatment_plan_items
  set status = 'cancelled'
  where plan_id = p_plan and status = 'planned';

  update public.treatment_plans
  set status = 'cancelled', decline_reason = p_reason
  where id = p_plan;
end;
$$;

grant execute on function public.cancel_treatment_plan(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Deleting a plan that never happened
-- ---------------------------------------------------------------------
-- For the plan opened by mistake: nothing is attached to it, so there is
-- nothing to keep. Anything with history is cancelled, never deleted.
create or replace function public.delete_treatment_plan(p_plan uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_plan public.treatment_plans;
begin
  select * into v_plan from public.treatment_plans where id = p_plan for update;
  if not found then raise exception 'Treatment plan not found'; end if;
  if not public.is_member(v_plan.clinic_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if exists (select 1 from public.payments where treatment_plan_id = p_plan) then
    raise exception 'This plan has payments on it; cancel it instead of deleting it';
  end if;
  if exists (select 1 from public.sessions where treatment_plan_id = p_plan) then
    raise exception 'Visits have been recorded on this plan; cancel it instead of deleting it';
  end if;
  if exists (select 1 from public.installment_plans where treatment_plan_id = p_plan) then
    raise exception 'This plan has an instalment schedule; cancel it instead of deleting it';
  end if;
  if exists (
    select 1 from public.lab_cases lc
    join public.treatment_plan_items i on i.id = lc.plan_item_id
    where i.plan_id = p_plan
  ) then
    raise exception 'Lab work was ordered against this plan; cancel it instead of deleting it';
  end if;

  -- An appointment may point at the plan; it keeps its slot, it just
  -- stops referring to something that no longer exists.
  update public.appointments set treatment_plan_id = null where treatment_plan_id = p_plan;

  delete from public.treatment_plan_items where plan_id = p_plan;
  delete from public.treatment_plans where id = p_plan;
end;
$$;

grant execute on function public.delete_treatment_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. The day of the month instalments fall on
-- ---------------------------------------------------------------------
-- The clinic collects on fixed days. Any of these is safe to add months
-- to: no month is short enough to push the date into the next one.
alter table public.clinics
  add column if not exists installment_day smallint
    check (installment_day is null or installment_day in (5, 10, 15, 20, 25));

update public.clinics set installment_day = 5 where installment_day is null;

grant update (installment_day) on public.clinics to authenticated;
