-- =====================================================================
-- Dental Clinic System — migration 0007: materials & finance
-- Requires: 0001–0006
--
-- Materials
--   * materials + append-only material_movements (stock = sum of movements)
--   * procedure_materials: "this procedure uses N of that material";
--     marking a plan item done deducts it automatically
--   * record_purchase(): stock in + matching expense, in one transaction
--   * record_stock_count(): enter the real quantity, the difference is logged
-- Finance (owner only)
--   * expenses (voided, never deleted)
--   * lab fees become lab expenses automatically when lab work is sent
--   * finance_summary(): income by method, expenses by category, net,
--     money still owed — for any date range
-- =====================================================================

create type public.movement_kind as enum ('purchase', 'usage', 'auto_usage', 'adjustment');
create type public.expense_category as enum
  ('rent', 'salaries', 'materials', 'lab', 'utilities', 'maintenance', 'marketing', 'other');

-- ---------------------------------------------------------------------
-- Materials
-- ---------------------------------------------------------------------
create table public.materials (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  name            text not null,
  unit            text not null default 'piece',     -- piece, box, cartridge, ml, pack…
  min_stock       numeric(12,2) not null default 0 check (min_stock >= 0),
  supplier_name   text,
  supplier_phone  text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (clinic_id, name),
  unique (id, clinic_id)
);

create table public.material_movements (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id),
  material_id   uuid not null,
  kind          public.movement_kind not null,
  quantity      numeric(12,2) not null check (quantity <> 0),  -- + in, − out
  total_cost    numeric(12,2) check (total_cost >= 0),         -- purchases only
  plan_item_id  uuid references public.treatment_plan_items(id),
  note          text,
  occurred_on   date not null default current_date,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  check ((kind = 'purchase') = (quantity > 0 and total_cost is not null)
         or kind = 'adjustment'),
  check (kind not in ('usage', 'auto_usage') or quantity < 0),
  unique (id, clinic_id),
  foreign key (material_id, clinic_id) references public.materials (id, clinic_id)
);
create index material_movements_material_idx on public.material_movements (material_id, occurred_on);

create trigger material_movements_append_only
  before update or delete on public.material_movements
  for each row execute function public.forbid_mutation();

create table public.procedure_materials (
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  procedure_id  uuid not null,
  material_id   uuid not null,
  quantity      numeric(12,2) not null check (quantity > 0),
  primary key (procedure_id, material_id),
  foreign key (procedure_id, clinic_id) references public.procedures (id, clinic_id) on delete cascade,
  foreign key (material_id, clinic_id)  references public.materials  (id, clinic_id) on delete cascade
);

create view public.material_stock with (security_invoker = true) as
select
  m.id as material_id, m.clinic_id, m.name, m.unit, m.min_stock, m.supplier_name, m.supplier_phone, m.active,
  coalesce(s.on_hand, 0)                                  as on_hand,
  coalesce(s.on_hand, 0) <= m.min_stock and m.active      as is_low,
  lp.unit_cost                                            as last_unit_cost,
  lp.occurred_on                                          as last_purchase_on
from public.materials m
left join lateral (
  select sum(mv.quantity) as on_hand from public.material_movements mv where mv.material_id = m.id
) s on true
left join lateral (
  select round(mv.total_cost / mv.quantity, 2) as unit_cost, mv.occurred_on
  from public.material_movements mv
  where mv.material_id = m.id and mv.kind = 'purchase'
  order by mv.occurred_on desc, mv.created_at desc limit 1
) lp on true;

-- Marking a plan item done deducts the materials its procedure uses.
create or replace function public.deduct_materials_on_done()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'done' and old.status <> 'done' and new.procedure_id is not null then
    insert into public.material_movements (clinic_id, material_id, kind, quantity, plan_item_id, note, occurred_on)
    select new.clinic_id, pm.material_id, 'auto_usage', -pm.quantity, new.id, null, public.clinic_today(new.clinic_id)
    from public.procedure_materials pm
    join public.materials m on m.id = pm.material_id and m.active
    where pm.procedure_id = new.procedure_id;
  end if;
  return null;
end;
$$;

create trigger treatment_plan_items_deduct_materials
  after update of status on public.treatment_plan_items
  for each row execute function public.deduct_materials_on_done();

-- ---------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------
create table public.expenses (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null references public.clinics(id),
  spent_on              date not null,
  category              public.expense_category not null,
  amount                numeric(12,2) not null check (amount > 0),
  method                public.payment_method,           -- null: not paid yet / unknown (auto lab fees)
  paid_to               text,
  note                  text,
  material_movement_id  uuid unique references public.material_movements(id),
  lab_case_id           uuid unique references public.lab_cases(id),
  voided_at             timestamptz,
  void_reason           text,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  check (voided_at is null or length(trim(coalesce(void_reason, ''))) > 0)
);
create index expenses_clinic_date_idx on public.expenses (clinic_id, spent_on);

-- Money fields can't be rewritten; mistakes are voided and re-entered.
create or replace function public.guard_expense()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
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

create trigger expenses_guard
  before update or delete on public.expenses
  for each row execute function public.guard_expense();

-- Lab fees follow their lab case: created when sent, kept in sync, voided if cancelled.
create or replace function public.sync_lab_expense()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_lab text;
begin
  select name into v_lab from public.labs where id = new.lab_id;

  if tg_op = 'INSERT' then
    if new.lab_fee is not null and new.lab_fee > 0 then
      insert into public.expenses (clinic_id, spent_on, category, amount, paid_to, note, lab_case_id)
      values (new.clinic_id, new.sent_on, 'lab', new.lab_fee, v_lab, new.description, new.id);
    end if;
    return null;
  end if;

  -- UPDATE
  if new.cancelled_at is not null and old.cancelled_at is null then
    update public.expenses set voided_at = now(), void_reason = 'Lab work cancelled'
    where lab_case_id = new.id and voided_at is null;
  elsif new.lab_fee is distinct from old.lab_fee or new.sent_on is distinct from old.sent_on then
    if coalesce(new.lab_fee, 0) > 0 then
      insert into public.expenses (clinic_id, spent_on, category, amount, paid_to, note, lab_case_id)
      values (new.clinic_id, new.sent_on, 'lab', new.lab_fee, v_lab, new.description, new.id)
      on conflict (lab_case_id) do update
        set amount = excluded.amount, spent_on = excluded.spent_on
        where public.expenses.voided_at is null;
    else
      update public.expenses set voided_at = now(), void_reason = 'Lab fee removed'
      where lab_case_id = new.id and voided_at is null;
    end if;
  end if;
  return null;
end;
$$;

create trigger lab_cases_sync_expense
  after insert or update on public.lab_cases
  for each row execute function public.sync_lab_expense();

-- Lab fees on lab work sent before this migration.
insert into public.expenses (clinic_id, spent_on, category, amount, paid_to, note, lab_case_id)
select lc.clinic_id, lc.sent_on, 'lab', lc.lab_fee, l.name, lc.description, lc.id
from public.lab_cases lc join public.labs l on l.id = lc.lab_id
where lc.lab_fee > 0 and lc.cancelled_at is null;

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------

-- Stock in + the matching materials expense, together.
create or replace function public.record_purchase(
  p_material_id  uuid,
  p_quantity     numeric,
  p_total_cost   numeric,
  p_method       public.payment_method,
  p_occurred_on  date default null,
  p_note         text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_m   public.materials;
  v_mv  uuid;
  v_on  date;
begin
  select * into v_m from public.materials where id = p_material_id;
  if not found then raise exception 'Material not found'; end if;
  if not public.is_member(v_m.clinic_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  if p_total_cost is null or p_total_cost < 0 then raise exception 'Cost can''t be negative'; end if;
  v_on := coalesce(p_occurred_on, public.clinic_today(v_m.clinic_id));

  insert into public.material_movements (clinic_id, material_id, kind, quantity, total_cost, note, occurred_on)
  values (v_m.clinic_id, v_m.id, 'purchase', p_quantity, p_total_cost, nullif(trim(p_note), ''), v_on)
  returning id into v_mv;

  if p_total_cost > 0 then
    insert into public.expenses (clinic_id, spent_on, category, amount, method, paid_to, note, material_movement_id)
    values (v_m.clinic_id, v_on, 'materials', p_total_cost, p_method, v_m.supplier_name,
            format('%s × %s', trim(to_char(p_quantity, 'FM999999990.##')), v_m.name), v_mv);
  end if;
  return v_mv;
end;
$$;

-- Manual usage (expired, broken, used outside a plan).
create or replace function public.record_usage(p_material_id uuid, p_quantity numeric, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.materials;
  v_id uuid;
begin
  select * into v_m from public.materials where id = p_material_id;
  if not found then raise exception 'Material not found'; end if;
  if not public.is_member(v_m.clinic_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  insert into public.material_movements (clinic_id, material_id, kind, quantity, note, occurred_on)
  values (v_m.clinic_id, v_m.id, 'usage', -p_quantity, nullif(trim(p_note), ''), public.clinic_today(v_m.clinic_id))
  returning id into v_id;
  return v_id;
end;
$$;

-- Stock count: enter what's really on the shelf; the difference is recorded.
create or replace function public.record_stock_count(p_material_id uuid, p_counted numeric)
returns numeric
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_m     public.materials;
  v_on    numeric;
  v_diff  numeric;
begin
  select * into v_m from public.materials where id = p_material_id for update;
  if not found then raise exception 'Material not found'; end if;
  if not public.is_member(v_m.clinic_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Count can''t be negative'; end if;
  select coalesce(sum(quantity), 0) into v_on from public.material_movements where material_id = v_m.id;
  v_diff := p_counted - v_on;
  if v_diff <> 0 then
    insert into public.material_movements (clinic_id, material_id, kind, quantity, note, occurred_on)
    values (v_m.clinic_id, v_m.id, 'adjustment', v_diff,
            format('Stock count: %s (was %s)', p_counted, v_on), public.clinic_today(v_m.clinic_id));
  end if;
  return v_diff;
end;
$$;

-- Owner-only money picture for a date range (clinic timezone).
create or replace function public.finance_summary(p_clinic uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v jsonb;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see finances' using errcode = '42501';
  end if;
  select timezone into v_tz from public.clinics where id = p_clinic;

  with pay as (
    select p.method, p.amount
    from public.payments p
    where p.clinic_id = p_clinic
      and (p.received_at at time zone v_tz)::date between p_from and p_to
  ), exp as (
    select e.category, e.amount
    from public.expenses e
    where e.clinic_id = p_clinic and e.voided_at is null and e.spent_on between p_from and p_to
  )
  select jsonb_build_object(
    'income',           coalesce((select sum(amount) from pay), 0),
    'income_by_method', coalesce((select jsonb_object_agg(method, total) from
                           (select method, sum(amount) total from pay group by method) x), '{}'::jsonb),
    'reversals',        coalesce((select -sum(amount) from pay where amount < 0), 0),
    'expenses',         coalesce((select sum(amount) from exp), 0),
    'expenses_by_category', coalesce((select jsonb_object_agg(category, total) from
                           (select category, sum(amount) total from exp group by category) x), '{}'::jsonb),
    'net',              coalesce((select sum(amount) from pay), 0) - coalesce((select sum(amount) from exp), 0),
    'owed_now',         coalesce((select sum(outstanding) from public.patient_balance where clinic_id = p_clinic), 0),
    'overdue_now',      coalesce((select sum(overdue_amount) from public.patient_balance where clinic_id = p_clinic), 0),
    'stock_value',      coalesce((select sum(greatest(on_hand, 0) * coalesce(last_unit_cost, 0))
                                  from public.material_stock where clinic_id = p_clinic and active), 0)
  ) into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS & grants
-- ---------------------------------------------------------------------
alter table public.materials            enable row level security;
alter table public.material_movements   enable row level security;
alter table public.procedure_materials  enable row level security;
alter table public.expenses             enable row level security;

-- Materials: the whole team manages stock.
create policy materials_select on public.materials for select to authenticated using (public.is_member(clinic_id));
create policy materials_insert on public.materials for insert to authenticated with check (public.is_member(clinic_id));
create policy materials_update on public.materials for update to authenticated
  using (public.is_member(clinic_id)) with check (public.is_member(clinic_id));
create policy material_movements_select on public.material_movements for select to authenticated
  using (public.is_member(clinic_id));

-- Recipes: everyone reads, the owner decides.
create policy procedure_materials_select on public.procedure_materials for select to authenticated
  using (public.is_member(clinic_id));
create policy procedure_materials_write on public.procedure_materials for all to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]))
  with check (public.has_role(clinic_id, array['owner']::public.member_role[]));

-- Expenses: owner only.
create policy expenses_select on public.expenses for select to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.has_role(clinic_id, array['owner']::public.member_role[]));
create policy expenses_update on public.expenses for update to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]))
  with check (public.has_role(clinic_id, array['owner']::public.member_role[]));

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;
revoke insert, update, delete on public.material_movements from authenticated;
revoke delete on public.materials, public.expenses from authenticated;
grant select on public.material_stock to authenticated;

revoke execute on function public.deduct_materials_on_done() from authenticated;
revoke execute on function public.sync_lab_expense()          from authenticated;
revoke execute on function public.guard_expense()             from authenticated;

grant execute on function
  public.record_purchase(uuid, numeric, numeric, public.payment_method, date, text),
  public.record_usage(uuid, numeric, text),
  public.record_stock_count(uuid, numeric),
  public.finance_summary(uuid, date, date)
to authenticated;

-- Supabase re-grants new objects to anon by default; the patient form RPCs must stay callable.
grant execute on function public.get_form_by_token(text), public.submit_form(text, jsonb, text, text) to anon;
