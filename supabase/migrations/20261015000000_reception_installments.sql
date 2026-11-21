-- =====================================================================
-- Dental Clinic System — migration 0027: reception can set up
-- instalments at the desk.
-- Requires: 0001–0026
--
-- Setting the terms was limited to a doctor, which left the receptionist
-- unable to finish a plan the patient had already agreed to.
--
-- Only the permission line changes; the body is migration 0002's,
-- word for word.
--
-- What she still cannot do is unchanged, and deliberately so: revising
-- terms, cancelling a schedule and reversing a payment stay with the
-- doctor or the owner, because each rewrites money already agreed or taken.
-- =====================================================================

create or replace function public.create_installment_plan(
  p_treatment_plan_id uuid,
  p_down_payment      numeric,
  p_months            int,
  p_first_due_date    date)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_plan  public.treatment_plans;
  v_net   numeric(12,2);
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
  if p_down_payment is null or p_down_payment < 0 or p_down_payment > v_net then
    raise exception 'Down payment must be between 0 and %', v_net;
  end if;
  if p_down_payment = v_net and coalesce(p_months, 0) <> 0 then
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
    v_id, v_plan.clinic_id, v_net - p_down_payment, coalesce(p_months, 0), p_first_due_date, 1);

  if v_plan.status::text in ('draft', 'presented') then
    update public.treatment_plans set status = 'active' where id = v_plan.id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.create_installment_plan(uuid, numeric, int, date) to authenticated;
