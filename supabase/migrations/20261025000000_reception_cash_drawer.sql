-- =====================================================================
-- Dental Clinic System — migration 0037: the drawer is reception's job
-- Requires: 0001–0036
--
-- Reception takes the money all day and counts the notes at night, so
-- the drawer screen is hers: the day's payments, the cash that left it,
-- the expected total, and the count itself. Nothing else moves.
--
--   drawer (this)        → owner + receptionist
--   finance / P&L        → owner only (unchanged)
--   doctor earnings      → owner only (unchanged)
--   expenses, settings   → owner only (unchanged)
--
-- A doctor is deliberately left out: he never holds the drawer.
--
-- The closing stays append-only and still records closed_by, so who
-- counted which night remains on the record.
-- =====================================================================

-- Who may see and close the drawer.
create or replace function public.can_handle_cash(p_clinic uuid)
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select public.has_role(p_clinic, array['owner', 'receptionist']::public.member_role[]);
$$;

grant execute on function public.can_handle_cash(uuid) to authenticated;

-- Same body as 0031, only the gate changes.
create or replace function public.cash_day_summary(p_clinic uuid, p_date date)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_tz     text;
  v_float  numeric(12,2);
  v_in     numeric(12,2);
  v_out    numeric(12,2);
  v_closed jsonb;
  v_pay    jsonb;
  v_exp    jsonb;
  v_meth   jsonb;
begin
  if not public.can_handle_cash(p_clinic) then
    raise exception 'Only the owner or reception can open the cash drawer' using errcode = '42501';
  end if;
  select timezone, cash_float into v_tz, v_float from public.clinics where id = p_clinic;

  select coalesce(sum(p.amount), 0) into v_in
  from public.payments p
  where p.clinic_id = p_clinic and p.method = 'cash'
    and (p.received_at at time zone v_tz)::date = p_date;

  select coalesce(sum(e.amount), 0) into v_out
  from public.expenses e
  where e.clinic_id = p_clinic and e.method = 'cash' and e.voided_at is null and e.spent_on = p_date;

  select to_jsonb(c) into v_closed from public.cash_closings c
  where c.clinic_id = p_clinic and c.business_date = p_date;

  -- Every payment of the day, in the order it was taken.
  select coalesce(jsonb_agg(x order by x->>'at'), '[]'::jsonb) into v_pay
  from (
    select jsonb_build_object(
      'id',          p.id,
      'at',          p.received_at,
      'receipt_no',  p.receipt_no,
      'patient_id',  p.patient_id,
      'patient',     pt.full_name,
      'amount',      p.amount,
      'method',      p.method,
      'note',        p.note,
      'is_reversal', p.reverses_payment_id is not null,
      'taken_by',    coalesce(m.display_name, '')
    ) as x
    from public.payments p
    join public.patients pt on pt.id = p.patient_id
    left join public.clinic_members m
      on m.clinic_id = p.clinic_id and m.user_id = p.received_by
    where p.clinic_id = p_clinic
      and (p.received_at at time zone v_tz)::date = p_date
  ) s;

  -- What left the drawer, and for what. Cash only: this is the till,
  -- not the expense book — a bank transfer never shows up here.
  select coalesce(jsonb_agg(x order by x->>'category'), '[]'::jsonb) into v_exp
  from (
    select jsonb_build_object(
      'id',       e.id,
      'category', e.category,
      'amount',   e.amount,
      'paid_to',  e.paid_to,
      'note',     e.note
    ) as x
    from public.expenses e
    where e.clinic_id = p_clinic and e.method = 'cash'
      and e.voided_at is null and e.spent_on = p_date
  ) s;

  -- The day's income split by how it was paid.
  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into v_meth
  from (
    select p.method::text as method, sum(p.amount) as total
    from public.payments p
    where p.clinic_id = p_clinic
      and (p.received_at at time zone v_tz)::date = p_date
    group by p.method
  ) s;

  return jsonb_build_object(
    'date',            p_date,
    'opening_float',   v_float,
    'cash_in',         v_in,
    'cash_out',        v_out,
    'expected_cash',   v_float + v_in - v_out,
    'closing',         v_closed,
    'payments',        v_pay,
    'cash_expenses',   v_exp,
    'income_by_method', v_meth
  );
end;
$$;

-- Closing the day: same rules, same append-only record, wider door.
-- The expected figure is still recomputed here and never sent by the app.
create or replace function public.record_cash_closing(
  p_clinic  uuid,
  p_date    date,
  p_counted numeric,
  p_reason  text default null,
  p_note    text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  s          jsonb;
  v_expected numeric(12,2);
  v_diff     numeric(12,2);
  v_id       uuid;
begin
  if not public.can_handle_cash(p_clinic) then
    raise exception 'Only the owner or reception can close the cash drawer' using errcode = '42501';
  end if;

  s := public.cash_day_summary(p_clinic, p_date);
  if s->'closing' <> 'null'::jsonb and s->'closing' is not null then
    raise exception 'ALREADY_CLOSED: this day is already closed';
  end if;
  if p_date > public.clinic_today(p_clinic) then
    raise exception 'Cannot close a day that has not happened yet';
  end if;
  if p_counted is null or p_counted < 0 then raise exception 'Counted cash can''t be negative'; end if;

  v_expected := (s->>'expected_cash')::numeric;
  v_diff := round(p_counted - v_expected, 2);
  if v_diff <> 0 and length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'DIFFERENCE_REASON: a difference of % needs a reason', v_diff;
  end if;

  insert into public.cash_closings
    (clinic_id, business_date, opening_float, cash_in, cash_out, expected_cash, counted_cash, difference, reason, note)
  values
    (p_clinic, p_date, (s->>'opening_float')::numeric, (s->>'cash_in')::numeric, (s->>'cash_out')::numeric,
     v_expected, p_counted, v_diff, nullif(trim(p_reason), ''), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- The history table itself, so last night's count is visible too.
drop policy if exists cash_closings_select on public.cash_closings;
create policy cash_closings_select on public.cash_closings for select to authenticated
  using (public.can_handle_cash(clinic_id));

-- Still no direct writes: the RPC above is the only way in.
revoke insert, update, delete on public.cash_closings from authenticated;

grant execute on function
  public.cash_day_summary(uuid, date),
  public.record_cash_closing(uuid, date, numeric, text, text)
to authenticated;
