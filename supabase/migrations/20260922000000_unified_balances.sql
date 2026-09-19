-- =====================================================================
-- Dental Clinic System — migration 0004: unified balances
-- Requires: 0001–0003
--
-- Until now balances only came from installment plans, so a patient who
-- owed money on a pay-per-session plan looked fully paid. These views
-- compute what's owed on every accepted plan, whichever way it's billed.
-- =====================================================================

-- One row per accepted plan (active or completed).
--   billing = 'installments' : the plan has an active installment plan;
--                              figures come from installment_plan_summary.
--   billing = 'per_session'  : no active installment plan; owed = plan total
--                              minus every payment linked to the plan
--                              (reversals are negative, so they net out).
create view public.treatment_plan_balance with (security_invoker = true) as
select
  tp.id                                   as treatment_plan_id,
  tp.clinic_id,
  tp.patient_id,
  tp.title,
  tp.status,
  ip.id                                   as installment_plan_id,
  case when ip.id is not null then 'installments' else 'per_session' end as billing,
  public.plan_net_total(tp.id)            as net_total,
  case when ip.id is not null then coalesce(ips.total_paid, 0) else coalesce(pay.paid, 0) end as paid,
  case
    when ip.id is not null then coalesce(ips.outstanding, 0)
    else greatest(public.plan_net_total(tp.id) - coalesce(pay.paid, 0), 0)
  end                                     as outstanding,
  coalesce(ips.overdue_count, 0)          as overdue_count,
  coalesce(ips.overdue_amount, 0)         as overdue_amount,
  coalesce(ips.sessions_locked, false)    as sessions_locked
from public.treatment_plans tp
left join public.installment_plans ip
  on ip.treatment_plan_id = tp.id and ip.status = 'active'
left join public.installment_plan_summary ips
  on ips.installment_plan_id = ip.id
left join lateral (
  select sum(p.amount) as paid from public.payments p where p.treatment_plan_id = tp.id
) pay on true
where tp.status::text in ('active', 'completed');

-- One row per patient who owes anything or has overdue installments.
create view public.patient_balance with (security_invoker = true) as
select
  b.clinic_id,
  b.patient_id,
  sum(b.outstanding)                                             as outstanding,
  sum(b.outstanding) filter (where b.billing = 'per_session')    as per_session_outstanding,
  sum(b.overdue_count)::int                                      as overdue_count,
  sum(b.overdue_amount)                                          as overdue_amount
from public.treatment_plan_balance b
group by b.clinic_id, b.patient_id
having sum(b.outstanding) > 0 or sum(b.overdue_count) > 0;

grant select on public.treatment_plan_balance, public.patient_balance to authenticated;
revoke all on public.treatment_plan_balance, public.patient_balance from anon;
