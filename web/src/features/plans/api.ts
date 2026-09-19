import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'

export type PlanItem = Tables<'treatment_plan_items'>
export type Procedure = Pick<Tables<'procedures'>, 'id' | 'name' | 'default_price'>
export type PlanStatus = 'draft' | 'presented' | 'declined' | 'active' | 'completed' | 'cancelled'

export async function getPlan(planId: string) {
  const { data: plan, error } = await supabase.from('treatment_plans').select('*').eq('id', planId).maybeSingle()
  if (error) throw error
  if (!plan) return null

  const [items, patient, summary, procedures, sessions] = await Promise.all([
    supabase.from('treatment_plan_items').select('*').eq('plan_id', planId).order('created_at'),
    supabase.from('patients').select('id, full_name, medical_alerts').eq('id', plan.patient_id).single(),
    supabase.from('installment_plan_summary').select('*').eq('treatment_plan_id', planId).eq('status', 'active').maybeSingle(),
    supabase.from('procedures').select('id, name, default_price').eq('clinic_id', plan.clinic_id).eq('active', true).order('name'),
    supabase.from('sessions').select('id, performed_at, notes, lock_override, override_reason')
      .eq('treatment_plan_id', planId).order('performed_at', { ascending: false }),
  ])
  for (const r of [items, patient, summary, procedures, sessions]) if (r.error) throw r.error

  return {
    plan,
    items: items.data ?? [],
    patient: patient.data,
    installments: summary.data,
    procedures: procedures.data ?? [],
    sessions: sessions.data ?? [],
  }
}

export async function createPlan(clinicId: string, patientId: string, title: string) {
  const { data, error } = await supabase
    .from('treatment_plans')
    .insert({ clinic_id: clinicId, patient_id: patientId, title: title.trim() })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function addItems(
  clinicId: string,
  planId: string,
  lines: Array<{ procedureId: string; tooth: number | null; price: number; description: string | null }>,
) {
  const { error } = await supabase.from('treatment_plan_items').insert(
    lines.map((l) => ({
      clinic_id: clinicId,
      plan_id: planId,
      procedure_id: l.procedureId,
      tooth_number: l.tooth,
      price: l.price,
      description: l.description,
    })),
  )
  if (error) throw error
}

/** Items are cancelled, never deleted, so the plan's history stays intact. */
export async function cancelItem(itemId: string) {
  const { error } = await supabase.from('treatment_plan_items').update({ status: 'cancelled' }).eq('id', itemId)
  if (error) throw error
}

export async function setDiscount(planId: string, discount: number) {
  const { error } = await supabase.from('treatment_plans').update({ discount }).eq('id', planId)
  if (error) throw error
}

export async function setStatus(planId: string, status: PlanStatus, declineReason?: string) {
  const { error } = await supabase
    .from('treatment_plans')
    .update(declineReason !== undefined ? { status, decline_reason: declineReason } : { status })
    .eq('id', planId)
  if (error) throw error
}

export async function createInstallmentPlan(planId: string, downPayment: number, months: number, firstDue: string) {
  const { error } = await supabase.rpc('create_installment_plan', {
    p_treatment_plan_id: planId,
    p_down_payment: downPayment,
    p_months: months,
    p_first_due_date: firstDue,
  })
  if (error) throw error
}

export async function reviseInstallmentPlan(installmentPlanId: string, months: number, firstDue: string, reason: string) {
  const { error } = await supabase.rpc('revise_installment_plan', {
    p_installment_plan_id: installmentPlanId,
    p_months: months,
    p_first_due_date: firstDue,
    p_reason: reason.trim(),
  })
  if (error) throw error
}

export async function cancelInstallmentPlan(installmentPlanId: string, reason: string) {
  const { error } = await supabase.rpc('cancel_installment_plan', {
    p_installment_plan_id: installmentPlanId,
    p_reason: reason.trim(),
  })
  if (error) throw error
}
