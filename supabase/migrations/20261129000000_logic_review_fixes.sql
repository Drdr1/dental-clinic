-- Fixes from the full logic review (Nov 2026).
--
--  1. What a patient owes: pay-per-session plans count only work already done.
--  2. A closed cash day stays closed; the owner can reopen it.
--  3. Plan items: done work is final, prices and discounts are a doctor's call.
--  4. Instalments are scheduled on what is left after money already paid.
--  5. Direct payments: right patient, not more than the plan, not on a schedule.
--  6. Doctor commission on work uses the price after the plan's discount.
--  7. Only the owner reverses a payment.
--  8. A plan completes itself when its last open item is done or struck off.
--  9. Work can't be marked done on a declined or cancelled plan.
-- 10. The overdue-instalment lock also covers visits recorded without a plan.
-- 11. Session notes: only their doctor/author or the owner edits them, and edits are logged.
-- 15. Online booking ignores chairs that are switched off.
-- 16. A rejected online booking doesn't leave an empty patient file behind.
-- 18. A suspended clinic can still take money and cancel appointments; the
--     public booking page says it is unavailable instead of failing.

-- Small helper for this migration: rewrite a function body in place, failing
-- loudly if the text to change isn't there exactly once.
create or replace function pg_temp.patch(p_fn regprocedure, p_pattern text, p_replace text)
returns void language plpgsql as $$
declare
  v_def text := pg_get_functiondef(p_fn);
  v_n   int;
begin
  select count(*) into v_n from regexp_matches(v_def, p_pattern, 'g');
  if v_n <> 1 then
    raise exception 'patch of % expected 1 match of %, found %', p_fn, p_pattern, v_n;
  end if;
  execute regexp_replace(v_def, p_pattern, p_replace);
end;
$$;

-- ---------------------------------------------------------------------
-- Money helpers
-- ---------------------------------------------------------------------

-- Share of the list price the patient actually pays on this plan (after discount).
create or replace function public._plan_net_factor(p_plan uuid)
returns numeric language sql stable set search_path = public, pg_temp as $$
  select case when s.subtotal > 0 then greatest(s.subtotal - p.discount, 0) / s.subtotal else 0 end
  from public.treatment_plans p
  cross join lateral (
    select coalesce(sum(i.price), 0) as subtotal
    from public.treatment_plan_items i where i.plan_id = p.id and i.status <> 'cancelled'
  ) s
  where p.id = p_plan;
$$;

-- Value of the work already carried out on a plan, after its discount.
create or replace function public._plan_done_net(p_plan uuid)
returns numeric language sql stable set search_path = public, pg_temp as $$
  select round(coalesce(sum(i.price), 0) * coalesce(public._plan_net_factor(p_plan), 0), 2)
  from public.treatment_plan_items i where i.plan_id = p_plan and i.status = 'done';
$$;

-- Money paid on a plan outside any instalment schedule (reversals included, as negatives).
create or replace function public._plan_paid_outside_schedule(p_plan uuid)
returns numeric language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(p.amount), 0) from public.payments p
  where p.treatment_plan_id = p_plan and p.installment_plan_id is null;
$$;

-- ---------------------------------------------------------------------
-- 1. Plan balance
--   outstanding     what the patient owes: the schedule's remainder on an
--                   instalment plan; done work minus payments otherwise.
--   plan_remaining  what is left of the whole plan (the old "outstanding").
--   owed_now        due today: instalments due or late; done work unpaid.
-- ---------------------------------------------------------------------
create or replace view public.treatment_plan_balance
with (security_invoker = true) as
select tp.id as treatment_plan_id,
       tp.clinic_id,
       tp.patient_id,
       tp.title,
       tp.status,
       ip.id as installment_plan_id,
       case when ip.id is not null then 'installments' else 'per_session' end as billing,
       public.plan_net_total(tp.id) as net_total,
       case when ip.id is not null then coalesce(ips.total_paid, 0) + public._plan_paid_outside_schedule(tp.id)
            else coalesce(pay.paid, 0) end as paid,
       case when ip.id is not null then coalesce(ips.outstanding, 0)
            else greatest(public._plan_done_net(tp.id) - coalesce(pay.paid, 0), 0) end as outstanding,
       coalesce(ips.overdue_count, 0::bigint) as overdue_count,
       coalesce(ips.overdue_amount, 0::numeric) as overdue_amount,
       coalesce(ips.sessions_locked, false) as sessions_locked,
       case when ip.id is not null then coalesce(ips.outstanding, 0)
            else greatest(public.plan_net_total(tp.id) - coalesce(pay.paid, 0), 0) end as plan_remaining,
       case when ip.id is not null then coalesce((
              select sum(s.remaining) from public.installment_status s
              where s.installment_plan_id = ip.id and s.status in ('due', 'in_grace', 'overdue')), 0)
            else greatest(public._plan_done_net(tp.id) - coalesce(pay.paid, 0), 0) end as owed_now
from public.treatment_plans tp
left join public.installment_plans ip on ip.treatment_plan_id = tp.id and ip.status = 'active'
left join public.installment_plan_summary ips on ips.installment_plan_id = ip.id
left join lateral (select sum(p.amount) as paid from public.payments p where p.treatment_plan_id = tp.id) pay on true
where tp.status::text in ('active', 'completed');

-- ---------------------------------------------------------------------
-- 2. Closed cash days
-- ---------------------------------------------------------------------
create or replace function public._day_closed(p_clinic uuid, p_day date)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.cash_closings where clinic_id = p_clinic and business_date = p_day);
$$;
revoke all on function public._day_closed(uuid, date) from public, anon, authenticated;

create or replace function public.guard_closed_day() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tz text;
begin
  if coalesce(current_setting('app.purging_patient', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'payments' then
    if new.method = 'cash' then
      select timezone into v_tz from public.clinics where id = new.clinic_id;
      if public._day_closed(new.clinic_id, (coalesce(new.received_at, now()) at time zone v_tz)::date) then
        raise exception 'DAY_CLOSED: the cash drawer for this day is already closed';
      end if;
    end if;
    return new;
  end if;
  -- expenses
  if tg_op = 'INSERT' then
    if new.method = 'cash' and public._day_closed(new.clinic_id, new.spent_on) then
      raise exception 'DAY_CLOSED: the cash drawer for this day is already closed';
    end if;
  elsif (old.method = 'cash' and public._day_closed(old.clinic_id, old.spent_on))
     or (new.method = 'cash' and public._day_closed(new.clinic_id, new.spent_on)) then
    if (new.amount, new.method, new.spent_on, new.voided_at)
       is distinct from (old.amount, old.method, old.spent_on, old.voided_at) then
      raise exception 'DAY_CLOSED: the cash drawer for this day is already closed';
    end if;
  end if;
  return new;
end;
$$;

create trigger payments_closed_day before insert on public.payments
  for each row execute function public.guard_closed_day();
create trigger expenses_closed_day before insert or update on public.expenses
  for each row execute function public.guard_closed_day();

-- cash_closings stays append-only except for reopen_cash_day below.
create or replace function public.forbid_mutation() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.purging_patient', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'cash_closings' and tg_op = 'DELETE'
     and coalesce(current_setting('app.reopening_day', true), '') = 'on' then
    return old;
  end if;
  raise exception '% is append-only; use the proper correction function instead', tg_table_name;
end;
$$;

create or replace function public.reopen_cash_day(p_clinic uuid, p_date date, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cash_closings;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can reopen a closed day' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required'; end if;
  select * into c from public.cash_closings where clinic_id = p_clinic and business_date = p_date;
  if not found then raise exception 'This day is not closed'; end if;
  -- The closing itself goes into the audit log, whole, before it is removed.
  perform public._audit(p_clinic, 'money', 'cash.reopen', true, null, jsonb_build_object(
    'day', p_date, 'counted', c.counted_cash, 'expected', c.expected_cash, 'difference', c.difference,
    'closed_reason', c.reason, 'closed_by', c.closed_by, 'closed_at', c.closed_at, 'reason', trim(p_reason)));
  perform set_config('app.reopening_day', 'on', true);
  delete from public.cash_closings where id = c.id;
  perform set_config('app.reopening_day', 'off', true);
end;
$$;
revoke all on function public.reopen_cash_day(uuid, date, text) from public, anon;
grant execute on function public.reopen_cash_day(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3 + 8. Plan items and discounts
-- ---------------------------------------------------------------------
create or replace function public.guard_plan_item() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.purging_patient', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'done' then raise exception 'ITEM_DONE: work already carried out stays on the plan'; end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'done' then
      raise exception 'Items are marked done by recording a visit';
    end if;
    return new;
  end if;

  if old.status = 'done' then
    if (new.status, new.price, new.procedure_id, new.tooth_number, new.plan_id, new.done_in_session_id)
       is distinct from (old.status, old.price, old.procedure_id, old.tooth_number, old.plan_id, old.done_in_session_id) then
      raise exception 'ITEM_DONE: work already carried out stays on the plan';
    end if;
    return new;
  end if;

  if new.status = 'done' and new.done_in_session_id is null then
    raise exception 'Items are marked done by recording a visit';
  end if;
  if new.status <> 'done' and new.done_in_session_id is not null then
    raise exception 'Items are marked done by recording a visit';
  end if;
  if new.price is distinct from old.price and not public.is_doctor(new.clinic_id) then
    raise exception 'Only a doctor can change a price' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger treatment_plan_items_guard before insert or update or delete on public.treatment_plan_items
  for each row execute function public.guard_plan_item();

-- After any item change: the discount can't exceed the plan, and an active
-- plan with nothing left to do and something done is complete.
create or replace function public.after_plan_item_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan uuid := coalesce(new.plan_id, old.plan_id);
begin
  if coalesce(current_setting('app.purging_patient', true), '') = 'on' then return null; end if;
  if public.plan_net_total(v_plan) < 0 then
    raise exception 'DISCOUNT_TOO_BIG: the discount is larger than the plan';
  end if;
  update public.treatment_plans tp set status = 'completed'
  where tp.id = v_plan and tp.status::text = 'active'
    and exists (select 1 from public.treatment_plan_items i where i.plan_id = tp.id and i.status = 'done')
    and not exists (select 1 from public.treatment_plan_items i where i.plan_id = tp.id and i.status = 'planned');
  return null;
end;
$$;
create trigger treatment_plan_items_after after insert or update or delete on public.treatment_plan_items
  for each row execute function public.after_plan_item_change();

create or replace function public.guard_plan_discount() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_subtotal numeric;
begin
  if new.discount is not distinct from old.discount then return new; end if;
  select coalesce(sum(price), 0) into v_subtotal
  from public.treatment_plan_items where plan_id = new.id and status <> 'cancelled';
  if new.discount > v_subtotal then
    raise exception 'DISCOUNT_TOO_BIG: the discount is larger than the plan';
  end if;
  -- Applying the patient's payer percentage is routine; any other discount is a doctor's call.
  if not public.is_doctor(new.clinic_id)
     and not (new.payer_id is not null and new.payer_percent is not null
              and new.discount = round(v_subtotal * new.payer_percent) / 100) then
    raise exception 'Only a doctor can change the discount' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger treatment_plans_discount_guard before update of discount on public.treatment_plans
  for each row execute function public.guard_plan_discount();

-- Plans that are already finished in practice: complete them now (recall restarts).
update public.treatment_plans tp set status = 'completed'
where tp.status::text = 'active'
  and exists (select 1 from public.treatment_plan_items i where i.plan_id = tp.id and i.status = 'done')
  and not exists (select 1 from public.treatment_plan_items i where i.plan_id = tp.id and i.status = 'planned');

-- ---------------------------------------------------------------------
-- 4. Instalments start from what is still unpaid
-- ---------------------------------------------------------------------
create or replace function public.create_installment_plan(p_treatment_plan_id uuid, p_down_payment numeric, p_months integer, p_first_due_date date)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan  public.treatment_plans;
  v_net   numeric(12,2);
  v_due   numeric(12,2);
  v_id    uuid;
begin
  select * into v_plan from public.treatment_plans where id = p_treatment_plan_id for update;
  if not found then raise exception 'Treatment plan not found'; end if;
  if not public.is_member(v_plan.clinic_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_plan.status::text not in ('draft', 'presented', 'active') then
    raise exception 'Treatment plan is %', v_plan.status;
  end if;

  v_net := public.plan_net_total(p_treatment_plan_id);
  if v_net <= 0 then raise exception 'Plan total must be greater than zero'; end if;
  -- Money already taken on the plan is not asked for again.
  v_due := v_net - public._plan_paid_outside_schedule(p_treatment_plan_id);
  if v_due <= 0 then raise exception 'NOTHING_LEFT: this plan is already paid'; end if;
  if p_down_payment is null or p_down_payment < 0 or p_down_payment > v_due then
    raise exception 'Down payment must be between 0 and %', v_due;
  end if;
  if p_down_payment = v_due and coalesce(p_months, 0) <> 0 then
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
    v_id, v_plan.clinic_id, v_due - p_down_payment, coalesce(p_months, 0), p_first_due_date, 1);

  if v_plan.status::text in ('draft', 'presented') then
    update public.treatment_plans set status = 'active' where id = v_plan.id;
  end if;

  return v_id;
end;
$$;

select pg_temp.patch('public.revise_installment_plan(uuid, integer, date, text)',
  '(\s+)if v_new_net < v_paid then',
  '\1v_paid := v_paid + public._plan_paid_outside_schedule(v_ip.treatment_plan_id);\1if v_new_net < v_paid then');

-- ---------------------------------------------------------------------
-- 5. Direct payments
-- ---------------------------------------------------------------------
create or replace function public.record_direct_payment(p_patient_id uuid, p_amount numeric, p_method payment_method, p_treatment_plan_id uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clinic uuid;
  v_plan   public.treatment_plans;
  v_left   numeric(12,2);
  v_id     uuid;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if not found then raise exception 'Patient not found'; end if;
  if not public.is_member(v_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  if p_treatment_plan_id is not null then
    select * into v_plan from public.treatment_plans where id = p_treatment_plan_id for update;
    if not found or v_plan.patient_id <> p_patient_id then
      raise exception 'Treatment plan does not belong to this patient';
    end if;
    if v_plan.status::text in ('declined', 'cancelled') then
      raise exception 'Treatment plan is %', v_plan.status;
    end if;
    if exists (select 1 from public.installment_plans where treatment_plan_id = v_plan.id and status = 'active') then
      raise exception 'ON_SCHEDULE: this plan is paid through its instalment schedule';
    end if;
    v_left := public.plan_net_total(v_plan.id)
              - coalesce((select sum(amount) from public.payments where treatment_plan_id = v_plan.id), 0);
    if p_amount > v_left then
      raise exception 'Amount exceeds outstanding balance of %', greatest(v_left, 0);
    end if;
  end if;

  insert into public.payments (clinic_id, patient_id, treatment_plan_id, receipt_no, amount, method, note)
  values (v_clinic, p_patient_id, p_treatment_plan_id, public._next_receipt_no(v_clinic), p_amount, p_method, p_note)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Commission on work: price after the plan's discount
-- ---------------------------------------------------------------------
select pg_temp.patch('public.doctor_earnings(uuid, date, date)',
  'as uid, sum\(i\.price\) as value(\s+from public\.treatment_plan_items i\s+join public\.sessions s on s\.id = i\.done_in_session_id\s+where s\.clinic_id = p_clinic\s+and \(s\.performed_at)',
  'as uid, sum(i.price * coalesce(public._plan_net_factor(i.plan_id), 0)) as value\1');

create or replace view public.unscheduled_treatment
with (security_invoker = true) as
select tp.id as treatment_plan_id,
       tp.clinic_id,
       tp.patient_id,
       p.full_name,
       p.phone,
       tp.title,
       tp.accepted_at,
       round(sum(i.price) * coalesce(public._plan_net_factor(tp.id), 0), 2) as remaining_value,
       count(*) as remaining_items,
       (select max(s.performed_at) from public.sessions s where s.treatment_plan_id = tp.id) as last_session_at
from public.treatment_plans tp
join public.patients p on p.id = tp.patient_id
join public.treatment_plan_items i on i.plan_id = tp.id and i.status = 'planned'
where tp.accepted_at is not null
  and tp.status::text = 'active'
  and not exists (select 1 from public.appointments a
                  where a.patient_id = tp.patient_id and a.status = 'booked' and a.starts_at > now())
  and p.archived_at is null
group by tp.id, p.id;

-- ---------------------------------------------------------------------
-- 7. Reversing a payment is the owner's call
-- ---------------------------------------------------------------------
select pg_temp.patch('public.reverse_payment(uuid, text)',
  'if not public\.is_doctor\(v_pay\.clinic_id\) then\s+raise exception ''Only a doctor can reverse payments''',
  'if not public.has_role(v_pay.clinic_id, array[''owner'']::public.member_role[]) then
    raise exception ''Only the clinic owner can reverse payments''');

-- ---------------------------------------------------------------------
-- 9. Recording a visit
-- ---------------------------------------------------------------------
create or replace function public.record_session(p_patient_id uuid, p_notes text, p_is_recall_visit boolean, p_treatment_plan_id uuid default null, p_done_item_ids uuid[] default '{}', p_override_reason text default null, p_doctor_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clinic  uuid;
  v_id      uuid;
  v_marked  int;
  v_doctor  uuid;
  v_status  text;
  v_wanted  int := coalesce(array_length(p_done_item_ids, 1), 0);
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if not found then raise exception 'Patient not found'; end if;
  if not public.is_member(v_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;

  if p_treatment_plan_id is not null then
    select status::text into v_status from public.treatment_plans
    where id = p_treatment_plan_id and patient_id = p_patient_id;
    if not found then raise exception 'Treatment plan does not belong to this patient'; end if;
  end if;
  if v_wanted > 0 and p_treatment_plan_id is null then
    raise exception 'Items can only be marked done within a treatment plan';
  end if;
  if v_wanted > 0 then
    if v_status in ('declined', 'cancelled', 'completed') then
      raise exception 'Treatment plan is %', v_status;
    end if;
    -- Work done on a plan that was only proposed means it was accepted on the spot.
    if v_status in ('draft', 'presented') then
      update public.treatment_plans set status = 'active' where id = p_treatment_plan_id;
    end if;
  end if;

  -- Whose work this is: what the form says, else the caller if they are a
  -- doctor, else the patient's own doctor.
  v_doctor := p_doctor_id;
  if v_doctor is null then
    select m.user_id into v_doctor from public.clinic_members m
    where m.clinic_id = v_clinic and m.user_id = auth.uid() and m.role in ('owner', 'doctor');
  end if;
  if v_doctor is null then
    select p.primary_doctor_id into v_doctor from public.patients p where p.id = p_patient_id;
  end if;
  if v_doctor is not null and not exists (
    select 1 from public.clinic_members m
    where m.clinic_id = v_clinic and m.user_id = v_doctor and m.role in ('owner', 'doctor')
  ) then
    raise exception 'That doctor is not on this clinic''s team';
  end if;

  insert into public.sessions
    (clinic_id, patient_id, treatment_plan_id, doctor_id, notes, is_recall_visit, lock_override, override_reason)
  values
    (v_clinic, p_patient_id, p_treatment_plan_id, v_doctor, nullif(trim(p_notes), ''), coalesce(p_is_recall_visit, false),
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

-- ---------------------------------------------------------------------
-- 10. The lock counts every active schedule of the patient when no plan is picked
-- ---------------------------------------------------------------------
create or replace function public.enforce_session_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
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
  select c.lock_threshold into v_threshold from public.clinics c where c.id = new.clinic_id;

  -- With a plan: that plan's schedule. Without one: the patient's worst schedule,
  -- so leaving the plan out of the form doesn't get round the lock.
  select coalesce(max(n), 0) into v_overdue
  from (
    select count(*) as n
    from public.installment_status s
    join public.installment_plans ip on ip.id = s.installment_plan_id
    where ip.status = 'active' and s.status = 'overdue'
      and (case when new.treatment_plan_id is not null then ip.treatment_plan_id = new.treatment_plan_id
                else ip.patient_id = new.patient_id end)
    group by ip.id
  ) x;

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

-- ---------------------------------------------------------------------
-- 11. Session notes
-- ---------------------------------------------------------------------
drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions for update
  using (public.is_member(clinic_id)
         and (performed_by = auth.uid() or doctor_id = auth.uid()
              or public.has_role(clinic_id, array['owner']::public.member_role[])))
  with check (public.is_member(clinic_id));

create or replace function public.audit_sessions() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('app.purging_patient', true) = 'on'
       or not exists (select 1 from public.clinics where id = old.clinic_id) then return null; end if;
    perform public._audit(old.clinic_id, 'patients', 'session.delete', true, old.patient_id, jsonb_build_object(
      'at', old.performed_at, 'notes', old.notes));
    return null;
  end if;
  if new.notes is distinct from old.notes then
    perform public._audit(new.clinic_id, 'patients', 'session.notes', true, new.patient_id, jsonb_build_object(
      'at', new.performed_at, 'from', old.notes, 'to', new.notes));
  end if;
  return null;
end;
$$;
create trigger audit_sessions after update or delete on public.sessions
  for each row execute function public.audit_sessions();

-- ---------------------------------------------------------------------
-- 15 + 16 + 18. Online booking
-- ---------------------------------------------------------------------
select pg_temp.patch('public.booking_clinic(text)',
  'and booking_enabled;', 'and booking_enabled and public.clinic_plan_state(id) <> ''suspended'';');
select pg_temp.patch('public.booking_day(text, date, uuid)',
  'and booking_enabled;', 'and booking_enabled and public.clinic_plan_state(id) <> ''suspended'';');
select pg_temp.patch('public.booking_slots(text, date, uuid)',
  'and booking_enabled;', 'and booking_enabled and public.clinic_plan_state(id) <> ''suspended'';');
select pg_temp.patch('public.booking_slots(text, date, uuid)',
  'from public\.chairs where clinic_id = c\.id;', 'from public.chairs where clinic_id = c.id and active;');
select pg_temp.patch('public.book_appointment(text, uuid, timestamp with time zone, text, text, text)',
  'and booking_enabled;', 'and booking_enabled and public.clinic_plan_state(id) <> ''suspended'';');
select pg_temp.patch('public.book_appointment(text, uuid, timestamp with time zone, text, text, text)',
  'where ch\.clinic_id = c\.id\s', 'where ch.clinic_id = c.id and ch.active
    ');
-- Someone whose earlier request was turned down books again: bring the file back.
select pg_temp.patch('public.book_appointment(text, uuid, timestamp with time zone, text, text, text)',
  '(\s+)if v_patient is null then',
  '\1update public.patients set archived_at = null, archive_reason = null
  where id = v_patient and archive_reason = ''online_request_rejected'';\1if v_patient is null then');

-- Turning down an online request (cancelling it before it was confirmed) puts
-- away the file it created, if that file has nothing else in it.
create or replace function public.tidy_rejected_booking() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled'
     and old.source = 'online' and old.confirmed_at is null then
    update public.patients p
    set archived_at = now(), archive_reason = 'online_request_rejected'
    where p.id = new.patient_id
      and p.archived_at is null
      and p.source = 'other'
      and p.created_at >= old.created_at - interval '1 minute'
      and not exists (select 1 from public.appointments a
                      where a.patient_id = p.id and a.id <> new.id and a.status <> 'cancelled')
      and not exists (select 1 from public.treatment_plans where patient_id = p.id)
      and not exists (select 1 from public.sessions where patient_id = p.id)
      and not exists (select 1 from public.payments where patient_id = p.id)
      and not exists (select 1 from public.patient_files where patient_id = p.id);
  end if;
  return null;
end;
$$;
create trigger appointments_tidy_rejected after update of status on public.appointments
  for each row execute function public.tidy_rejected_booking();

-- A suspended clinic: still takes money, still cancels appointments.
drop trigger if exists payments_block_when_suspended on public.payments;

create or replace function public.block_when_suspended() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_clinic uuid := case when tg_op = 'DELETE' then old.clinic_id else new.clinic_id end;
begin
  if public.clinic_plan_state(v_clinic) = 'suspended' then
    -- (nested: other tables have no status/chair columns to look at)
    if tg_table_name = 'appointments' and tg_op = 'UPDATE' then
      if new.status::text in ('cancelled', 'no_show')
         and (new.starts_at, new.ends_at, new.chair_id, new.patient_id, new.doctor_id)
             is not distinct from (old.starts_at, old.ends_at, old.chair_id, old.patient_id, old.doctor_id) then
        return new;
      end if;
    end if;
    raise exception 'SUBSCRIPTION_SUSPENDED' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
