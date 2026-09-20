-- =====================================================================
-- Dental Clinic System — migration 0009: daily cash closing
-- Requires: 0001–0008
--
-- End of day: count the drawer, compare with what the system says should
-- be there (float + cash taken − cash spent), and record any difference
-- with its reason. Closings are owner-only and can never be edited.
-- The expected amount is always computed server-side.
-- =====================================================================

alter table public.clinics
  add column cash_float numeric(12,2) not null default 0 check (cash_float >= 0);

grant update (cash_float) on public.clinics to authenticated;

create table public.cash_closings (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references public.clinics(id),
  business_date  date not null,
  opening_float  numeric(12,2) not null,
  cash_in        numeric(12,2) not null,      -- cash payments, reversals already netted
  cash_out       numeric(12,2) not null,      -- expenses paid in cash
  expected_cash  numeric(12,2) not null,
  counted_cash   numeric(12,2) not null check (counted_cash >= 0),
  difference     numeric(12,2) not null,      -- counted − expected (+ over, − short)
  reason         text,
  note           text,
  closed_by      uuid not null default auth.uid(),
  closed_at      timestamptz not null default now(),
  unique (clinic_id, business_date),
  check (difference = 0 or length(trim(coalesce(reason, ''))) > 0)
);

create trigger cash_closings_append_only
  before update or delete on public.cash_closings
  for each row execute function public.forbid_mutation();

-- What the drawer should hold for a given day (owner only).
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
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can close the cash drawer' using errcode = '42501';
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

  return jsonb_build_object(
    'date', p_date,
    'opening_float', v_float,
    'cash_in', v_in,
    'cash_out', v_out,
    'expected_cash', v_float + v_in - v_out,
    'closing', v_closed
  );
end;
$$;

-- Records the count. The expected figure is recomputed here, never sent by the app.
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
  s := public.cash_day_summary(p_clinic, p_date);   -- also enforces owner-only
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

alter table public.cash_closings enable row level security;
create policy cash_closings_select on public.cash_closings for select to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]));

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;
revoke insert, update, delete on public.cash_closings from authenticated;

grant execute on function
  public.cash_day_summary(uuid, date),
  public.record_cash_closing(uuid, date, numeric, text, text)
to authenticated;

grant execute on function public.get_form_by_token(text), public.submit_form(text, jsonb, text, text) to anon;
