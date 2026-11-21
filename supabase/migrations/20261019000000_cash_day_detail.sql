-- =====================================================================
-- Dental Clinic System — migration 0031: the day's takings, line by line
-- Requires: 0001–0030
--
-- Closing the drawer on four totals asks whoever is counting to trust
-- them. This returns the day itself: every payment with the patient,
-- the method, the receipt number, who took it and when, and every cash
-- expense that left the drawer — so a count that doesn't match can be
-- traced to the line that caused it instead of being written off as a
-- difference.
--
-- The drawer arithmetic is unchanged and still cash-only; card and
-- transfer lines are listed because the person closing is reconciling
-- the whole day, not only the notes in the till.
-- =====================================================================

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

  -- What left the drawer, and for what.
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

grant execute on function public.cash_day_summary(uuid, date) to authenticated;
