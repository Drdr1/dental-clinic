import { supabase } from '../../lib/supabase'

export type AgreementTerms = {
  clinic: string
  currency: string
  patient: { name: string; phone: string }
  treatment: { title: string; discount: number; items: Array<{ description: string | null; tooth: number | null; price: number }> }
  net_total: number
  down_payment: number
  paid_to_date: number
  schedule: Array<{ seq: number; down_payment: boolean; due_date: string; amount: number; paid: number }>
  rules: { grace_days: number; session_lock_after_overdue: number; late_fees: boolean; installment_price_equals_cash: boolean }
  reason: string
  generated_at: string
}

export type Agreement = {
  id: string
  version: number
  terms: AgreementTerms
  signed_by_name: string | null
  signature_data: string | null
  signed_at: string | null
}

export async function getAgreements(installmentPlanId: string): Promise<Agreement[]> {
  const { data, error } = await supabase.from('installment_agreements').select('*')
    .eq('installment_plan_id', installmentPlanId).order('version', { ascending: false })
  if (error) throw error
  return data.map((a) => ({
    id: a.id, version: a.version, terms: a.terms as unknown as AgreementTerms,
    signed_by_name: a.signed_by_name, signature_data: a.signature_data, signed_at: a.signed_at,
  }))
}

export async function signAgreement(id: string, name: string, signature: string) {
  const { error } = await supabase.rpc('sign_installment_agreement', {
    p_agreement_id: id, p_signed_by_name: name.trim(), p_signature_data: signature,
  })
  if (error) throw error
}
