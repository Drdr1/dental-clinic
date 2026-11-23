-- =====================================================================
-- Subscriptions (the clinic paying DerOps), gateway-agnostic.
--
--   * A new clinic starts on a 14-day trial. Clinics that already exist
--     stay active with no end date, so nothing changes for them.
--   * DerOps records each payment with record_subscription_payment()
--     (service role only); it pushes the renewal date forward.
--   * Past the renewal date the clinic gets 7 days' grace, then it is
--     suspended: everything stays readable — a clinic is never locked out
--     of its patients' records — but new work cannot be written.
--   * The AI assistant stops at the monthly question limit, and when the
--     owner switched it off.
--   * With the materials part switched off, stock is no longer deducted.
-- =====================================================================

alter table public.clinics
  add column plan_status text not null default 'trial' check (plan_status in ('trial', 'active', 'cancelled')),
  add column trial_ends_on date default (current_date + 14);

-- Existing clinics: active, open-ended.
update public.clinics set plan_status = 'active', trial_ends_on = null;

create table public.subscription_payments (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  amount       numeric(10,2) not null check (amount >= 0),
  months       int not null check (months between 1 and 24),
  method       text not null,
  reference    text,
  period_from  date not null,
  period_to    date not null,
  recorded_at  timestamptz not null default now()
);
alter table public.subscription_payments enable row level security;
create policy subscription_payments_select on public.subscription_payments for select to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]));
revoke all on public.subscription_payments from anon, authenticated;
grant select on public.subscription_payments to authenticated;
create trigger subscription_payments_append_only before update or delete on public.subscription_payments
  for each row execute function public.forbid_mutation();

-- trial | active | past_due | suspended | cancelled, as of today.
create or replace function public.clinic_plan_state(p_clinic uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when c.plan_status = 'cancelled' then 'suspended'
    when c.plan_status = 'trial' then
      case when c.trial_ends_on is null or public.clinic_today(c.id) <= c.trial_ends_on then 'trial'
           when public.clinic_today(c.id) <= c.trial_ends_on + 7 then 'past_due'
           else 'suspended' end
    when c.plan_renews_on is null or public.clinic_today(c.id) <= c.plan_renews_on then 'active'
    when public.clinic_today(c.id) <= c.plan_renews_on + 7 then 'past_due'
    else 'suspended'
  end
  from public.clinics c where c.id = p_clinic;
$$;
revoke all on function public.clinic_plan_state(uuid) from public, anon;
grant execute on function public.clinic_plan_state(uuid) to authenticated;

-- DerOps only: a payment came in (InstaPay, bank transfer, a gateway…).
create or replace function public.record_subscription_payment(
  p_clinic uuid, p_amount numeric, p_months int, p_method text, p_reference text default null)
returns date
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare c public.clinics; v_from date; v_to date;
begin
  select * into c from public.clinics where id = p_clinic for update;
  if c.id is null then raise exception 'Clinic not found'; end if;
  -- A renewal continues from the old date if it has not passed yet.
  v_from := greatest(public.clinic_today(p_clinic), coalesce(c.plan_renews_on, '-infinity'::date) + 1);
  if c.plan_status = 'trial' then v_from := public.clinic_today(p_clinic); end if;
  v_to := (v_from + make_interval(months => p_months))::date - 1;
  insert into public.subscription_payments (clinic_id, amount, months, method, reference, period_from, period_to)
  values (p_clinic, p_amount, p_months, p_method, p_reference, v_from, v_to);
  update public.clinics set plan_status = 'active', plan_renews_on = v_to, trial_ends_on = null where id = p_clinic;
  return v_to;
end;
$$;
revoke all on function public.record_subscription_payment(uuid, numeric, int, text, text) from public, anon, authenticated;

-- A suspended clinic can read everything but write nothing new.
create or replace function public.block_when_suspended()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_clinic uuid := case when tg_op = 'DELETE' then old.clinic_id else new.clinic_id end;
begin
  if public.clinic_plan_state(v_clinic) = 'suspended' then
    raise exception 'SUBSCRIPTION_SUSPENDED' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['patients', 'appointments', 'treatment_plans', 'treatment_plan_items', 'sessions',
                           'payments', 'expenses', 'lab_cases', 'material_movements', 'prescriptions'] loop
    execute format('create trigger %1$s_block_when_suspended before insert or update or delete on public.%1$s
                      for each row execute function public.block_when_suspended()', t);
  end loop;
end $$;

-- The settings card: add the live state and the trial end.
create or replace function public.subscription_status(p_clinic uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare c public.clinics; v_from timestamptz;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see this' using errcode = '42501';
  end if;
  select * into c from public.clinics where id = p_clinic;
  v_from := date_trunc('month', now() at time zone c.timezone) at time zone c.timezone;
  return jsonb_build_object(
    'plan', c.plan_name,
    'price', c.plan_price,
    'state', public.clinic_plan_state(p_clinic),
    'renews_on', c.plan_renews_on,
    'trial_ends_on', c.trial_ends_on,
    'today', public.clinic_today(p_clinic),
    'chairs', (select count(*) from public.chairs where clinic_id = p_clinic and active),
    'users', (select count(*) from public.clinic_members where clinic_id = p_clinic and active),
    'assistant_used', (select count(*) from public.assistant_queries where clinic_id = p_clinic and asked_at >= v_from),
    'assistant_limit', c.assistant_monthly_limit);
end;
$$;

-- Asked by the assistant function before it calls the model.
create or replace function public.assistant_can_ask(p_clinic uuid)
returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare c public.clinics;
begin
  if not public.is_member(p_clinic) then raise exception 'Not a member' using errcode = '42501'; end if;
  select * into c from public.clinics where id = p_clinic;
  if 'assistant' = any(c.disabled_features) then raise exception 'ASSISTANT_OFF'; end if;
  if public.clinic_plan_state(p_clinic) = 'suspended' then raise exception 'SUBSCRIPTION_SUSPENDED'; end if;
  if (select count(*) from public.assistant_queries
      where clinic_id = p_clinic and asked_at >= date_trunc('month', now() at time zone c.timezone) at time zone c.timezone)
     >= c.assistant_monthly_limit then
    raise exception 'ASSISTANT_LIMIT';
  end if;
end;
$$;
revoke all on function public.assistant_can_ask(uuid) from public, anon;
grant execute on function public.assistant_can_ask(uuid) to authenticated;

-- Materials switched off: no automatic deduction.
create or replace function public.deduct_materials_on_done()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'done' and old.status <> 'done' and new.procedure_id is not null
     and not exists (select 1 from public.clinics where id = new.clinic_id and 'materials' = any(disabled_features)) then
    insert into public.material_movements (clinic_id, material_id, kind, quantity, plan_item_id, note, occurred_on)
    select new.clinic_id, pm.material_id, 'auto_usage', -pm.quantity, new.id, null, public.clinic_today(new.clinic_id)
    from public.procedure_materials pm
    join public.materials m on m.id = pm.material_id and m.active
    where pm.procedure_id = new.procedure_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.deduct_materials_on_done() from authenticated;
