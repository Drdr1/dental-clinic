-- =====================================================================
-- Dental Clinic System — migration 0045: reissue an old contract on the
-- current clauses
-- Requires: 0001–0044
--
-- Nada wants the contracts made before the clause update to carry the new
-- terms too. A signed contract is never rewritten — the patient put a
-- finger on six clauses, and turning that into twelve behind their back
-- would be forging their consent. So instead of editing, this issues a
-- NEW version on the current clauses, leaving the old version in the
-- record exactly as it was signed.
--
-- The schedule is untouched: same installments, same dates, same amounts.
-- Only the terms snapshot is taken again. If the old version was signed,
-- the new one starts unsigned and the patient signs it; if it was never
-- signed, nothing was agreed to and the new version simply replaces it
-- in practice.
-- =====================================================================

create or replace function public.reissue_installment_agreement(p_plan uuid)
returns smallint
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic  uuid;
  v_status  text;
  v_current smallint;
begin
  select ip.clinic_id, ip.status::text into v_clinic, v_status
  from public.installment_plans ip where ip.id = p_plan;
  if v_clinic is null then raise exception 'Installment plan not found'; end if;

  -- Reissuing restates the clinic's legal terms, so it is not reception's call.
  if not public.is_doctor(v_clinic) then
    raise exception 'Only a doctor or the owner can reissue a contract' using errcode = '42501';
  end if;
  if v_status <> 'active' then
    raise exception 'This installment plan is % — there is nothing to reissue', v_status;
  end if;

  select max(a.clauses) into v_current from (
    select coalesce((terms->>'clauses_version')::int, 1) as clauses
    from public.installment_agreements where installment_plan_id = p_plan) a;

  -- Already on the current clause set: issuing another identical version
  -- would just make the patient sign the same thing twice.
  if v_current >= 2 then
    raise exception 'ALREADY_CURRENT: this contract is already on the current terms';
  end if;

  perform public._snapshot_installment_agreement(p_plan, 'تحديث بنود العقد');
  return (select max(version) from public.installment_agreements where installment_plan_id = p_plan);
end;
$$;

grant execute on function public.reissue_installment_agreement(uuid) to authenticated;

-- How much of this is left to do, and how much of it needs a new signature.
create or replace function public.agreements_needing_reissue(p_clinic uuid)
returns table (
  installment_plan_id uuid,
  patient_id          uuid,
  patient_name        text,
  version             smallint,
  was_signed          boolean,
  net_total           numeric
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_doctor(p_clinic) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
  select ip.id, p.id, p.full_name, a.version, a.signed_at is not null, ip.net_total
  from public.installment_plans ip
  join public.patients p on p.id = ip.patient_id
  join lateral (
    select ag.version, ag.signed_at, coalesce((ag.terms->>'clauses_version')::int, 1) as clauses
    from public.installment_agreements ag
    where ag.installment_plan_id = ip.id
    order by ag.version desc limit 1
  ) a on true
  where ip.clinic_id = p_clinic
    and ip.status = 'active'
    and a.clauses < 2
  order by p.full_name;
end;
$$;

grant execute on function public.agreements_needing_reissue(uuid) to authenticated;
