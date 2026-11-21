-- =====================================================================
-- Dental Clinic System — migration 0043: the contract stands on its own
-- Requires: 0001–0042
--
-- Nada is printing the agreement now and does not want to print it twice,
-- so the clauses the clinic's paper contract carried have to be on it:
-- the patient's obligations, the clinic's right to stop treatment and to
-- go to court, the contract as proof of the debt, the patient's
-- acknowledgment that the plan and its cost were explained, and which
-- courts hear a dispute.
--
-- That needs three things the system never held: the patient's national
-- ID and address, the doctor who signs for the clinic, and the
-- governorate whose courts have jurisdiction.
--
-- Signed agreements must not change under the people who signed them, so
-- the snapshot carries clauses_version. Old agreements have none and keep
-- printing exactly the six clauses they were signed on; new ones print
-- the full set.
--
-- NOT LEGAL ADVICE: the wording follows the clinic's own paper contract.
-- A lawyer should read the printed result once before it goes into use.
-- =====================================================================

alter table public.patients
  add column if not exists national_id text,
  add column if not exists address     text;

comment on column public.patients.national_id is
  'Written on the installment contract so the debt is attached to a person.';

alter table public.clinics
  add column if not exists represented_by text,
  add column if not exists legal_venue    text;

comment on column public.clinics.legal_venue is
  'The governorate whose courts hear a dispute, e.g. السويس.';

-- clinics has column-level grants: a new column is invisible to the app
-- until it is granted, and saving settings fails with "permission denied".
grant update (represented_by, legal_venue) on public.clinics to authenticated;

-- ---------------------------------------------------------------------
-- The snapshot carries the new details and its clause set
-- ---------------------------------------------------------------------
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
      -- Who signs for the clinic, and where a dispute is heard.
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
                         'late_fees',                  false,
                         'installment_price_equals_cash', true),
      -- Anything already signed has no version and keeps its old clauses.
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
