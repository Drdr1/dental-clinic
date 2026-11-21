-- =====================================================================
-- Dental Clinic System — migration 0044: the right to stop treatment
-- gets its own number
-- Requires: 0001–0043
--
-- 0043 wrote the suspension clause against grace_days, so the printed
-- contract carried two different answers to the same question: clause 5
-- said treatment stops after 2 overdue installments, clause 8 said the
-- clinic may stop it after the grace period (3 days). A contract that
-- contradicts itself is worse than one that says less.
--
-- They are two different things and now have two different settings:
--
--   grace_days          — when an installment is counted late
--   lock_threshold      — when the SYSTEM stops booking new sessions
--   suspend_after_days  — the clinic's stated RIGHT to stop treatment,
--                         7 days on the clinic's own paper contract
--
-- Clause 5 describes what the software does; clause 8 states a right the
-- clinic may use. With separate numbers they no longer collide.
-- =====================================================================

alter table public.clinics
  add column if not exists suspend_after_days smallint not null default 7
    constraint clinics_suspend_after_days_sane check (suspend_after_days between 1 and 90);

comment on column public.clinics.suspend_after_days is
  'Days past a due date after which the contract says the clinic may stop treatment.';

grant update (suspend_after_days) on public.clinics to authenticated;

-- The snapshot carries it, so a signed contract keeps the number it was
-- signed on even if the clinic changes the rule later.
create or replace function public._snapshot_installment_agreement(
  p_installment_plan_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.installment_agreements (clinic_id, installment_plan_id, version, terms)
  select
    ip.clinic_id,
    ip.id,
    coalesce((select max(a.version) from public.installment_agreements a
              where a.installment_plan_id = ip.id), 0) + 1,
    jsonb_build_object(
      'clinic',        c.name,
      'currency',      c.currency,
      'represented_by', c.represented_by,
      'legal_venue',    c.legal_venue,
      'patient',       jsonb_build_object(
                         'name',        p.full_name,
                         'phone',       p.phone,
                         'national_id', p.national_id,
                         'address',     p.address),
      'treatment',     jsonb_build_object(
                         'title',    tp.title,
                         'discount', tp.discount,
                         'items',    (select coalesce(jsonb_agg(jsonb_build_object(
                                        'description', coalesce(i.description, pr.name),
                                        'tooth',       i.tooth_number,
                                        'price',       i.price) order by i.created_at), '[]'::jsonb)
                                      from public.treatment_plan_items i
                                      left join public.procedures pr on pr.id = i.procedure_id
                                      where i.plan_id = tp.id and i.status <> 'cancelled')),
      'net_total',     ip.net_total,
      'down_payment',  ip.down_payment,
      'paid_to_date',  (select coalesce(sum(s.paid), 0) from public.installment_status s
                        where s.installment_plan_id = ip.id),
      'schedule',      (select coalesce(jsonb_agg(jsonb_build_object(
                          'seq',          s.seq,
                          'down_payment', s.is_down_payment,
                          'due_date',     s.due_date,
                          'amount',       s.amount,
                          'paid',         s.paid) order by s.seq), '[]'::jsonb)
                        from public.installment_status s
                        where s.installment_plan_id = ip.id and s.status <> 'cancelled'),
      'rules',         jsonb_build_object(
                         'grace_days',                 c.grace_days,
                         'session_lock_after_overdue', c.lock_threshold,
                         'suspend_after_days',         c.suspend_after_days,
                         'late_fees',                  false,
                         'installment_price_equals_cash', true),
      'clauses_version', 2,
      'reason',        p_reason,
      'generated_at',  now())
  from public.installment_plans ip
  join public.clinics c          on c.id  = ip.clinic_id
  join public.patients p         on p.id  = ip.patient_id
  join public.treatment_plans tp on tp.id = ip.treatment_plan_id
  where ip.id = p_installment_plan_id;
end;
$$;

revoke execute on function public._snapshot_installment_agreement(uuid, text) from public, anon, authenticated;
