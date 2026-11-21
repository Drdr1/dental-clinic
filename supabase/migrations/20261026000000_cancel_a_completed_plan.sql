-- =====================================================================
-- Dental Clinic System — migration 0038: a plan marked finished by
-- mistake can still be retired
-- Requires: 0001–0037
--
-- A plan opened by mistake and then marked "completed" was a dead end:
-- cancelling refused because of the status, and deleting refused because
-- money had touched it. Reverse the payment and the plan's full value
-- comes back as a debt on the patient that nobody can clear.
--
-- Cancelling a completed plan is now allowed. Nothing else moves: a plan
-- somebody has paid into still needs a doctor or the owner, the reason
-- is still required, and the payments themselves stay on the record —
-- a cancelled plan simply drops out of the balance.
-- =====================================================================

-- The status guard did not allow the move at all. Same body as 0002 with
-- one transition added; every other rule is untouched.
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
    'active>completed', 'active>cancelled',
    'completed>cancelled'                     -- marked finished by mistake
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
  -- Only an already-cancelled plan is refused now; "completed" is a
  -- status somebody clicked, and clicking it must not be a trap.
  if v_plan.status::text = 'cancelled' then
    raise exception 'Treatment plan is already cancelled';
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

  -- Work already carried out keeps its 'done' status: it happened, and
  -- the visit history should still show it. Only what was never started
  -- is struck off.
  update public.treatment_plan_items
  set status = 'cancelled'
  where plan_id = p_plan and status = 'planned';

  update public.treatment_plans
  set status = 'cancelled', decline_reason = p_reason
  where id = p_plan;
end;
$$;

grant execute on function public.cancel_treatment_plan(uuid, text) to authenticated;
