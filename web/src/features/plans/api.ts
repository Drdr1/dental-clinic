import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'

export type PlanItem = Tables<'treatment_plan_items'>
export type Procedure = Pick<Tables<'procedures'>, 'id' | 'name' | 'default_price'>
export type PlanStatus = 'draft' | 'presented' | 'declined' | 'active' | 'completed' | 'cancelled'

export type PatientPayer = { id: string; name: string; discount_percent: number } | null

export async function getPlan(planId: string) {
  const { data: plan, error } = await supabase.from('treatment_plans').select('*').eq('id', planId).maybeSingle()
  if (error) throw error
  if (!plan) return null

  const [items, patient, summary, procedures, sessions, payments, staff] = await Promise.all([
    supabase.from('treatment_plan_items').select('*').eq('plan_id', planId).order('created_at'),
    supabase.from('patients').select('id, full_name, phone, whatsapp_phone, medical_alerts, payer_id, payers(id, name, discount_percent)')
      .eq('id', plan.patient_id).single(),
    supabase.from('installment_plan_summary').select('*').eq('treatment_plan_id', planId).eq('status', 'active').maybeSingle(),
    supabase.from('procedures').select('id, name, default_price').eq('clinic_id', plan.clinic_id).eq('active', true).order('name'),
    supabase.from('sessions').select('id, performed_at, notes, lock_override, override_reason, doctor_id, performed_by')
      .eq('treatment_plan_id', planId).order('performed_at', { ascending: false }),
    // Every payment on the plan. Filtering to installment_plan_id = null
    // used to hide money taken against a schedule that was later
    // cancelled: it showed nowhere and could not be reversed.
    supabase.from('payments').select('*').eq('treatment_plan_id', planId)
      .order('receipt_no', { ascending: false }),
    supabase.from('clinic_members').select('user_id, display_name').eq('clinic_id', plan.clinic_id),
  ])
  for (const r of [items, patient, summary, procedures, sessions, payments, staff]) if (r.error) throw r.error

  return {
    plan,
    items: items.data ?? [],
    patient: patient.data,
    installments: summary.data,
    procedures: procedures.data ?? [],
    sessions: sessions.data ?? [],
    planPayments: payments.data ?? [],
    staffNames: new Map((staff.data ?? []).map((m) => [m.user_id, m.display_name])),
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

export async function setDiscount(planId: string, discount: number, payer?: { id: string; percent: number } | null) {
  const { error } = await supabase.from('treatment_plans')
    .update(payer ? { discount, payer_id: payer.id, payer_percent: payer.percent } : { discount })
    .eq('id', planId)
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

/**
 * Retires a plan: the schedule is cancelled with it and the open items go
 * too. Anyone may cancel a plan nobody has paid into; once money has been
 * taken against it, the server allows only a doctor or the owner.
 */
export async function cancelPlan(planId: string, reason: string) {
  const { error } = await supabase.rpc('cancel_treatment_plan', { p_plan: planId, p_reason: reason.trim() })
  if (error) throw error
}

/** Removes a plan that never happened. Refused by the server if anything is attached. */
export async function deletePlan(planId: string) {
  const { error } = await supabase.rpc('delete_treatment_plan', { p_plan: planId })
  if (error) throw error
}
