import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'

export type InstallmentRow = Tables<'installment_status'>
export type Payment = Tables<'payments'>
export type PaymentMethod = 'cash' | 'card' | 'instapay' | 'wallet' | 'bank_transfer'
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'instapay', 'wallet', 'card', 'bank_transfer']

export async function getPatientLedger(patientId: string, clinicId: string) {
  const [installments, payments, staff] = await Promise.all([
    supabase.from('installment_status').select('*').eq('patient_id', patientId).order('seq'),
    supabase.from('payments').select('*').eq('patient_id', patientId).order('receipt_no', { ascending: false }),
    supabase.from('clinic_members').select('user_id, display_name').eq('clinic_id', clinicId),
  ])
  if (installments.error) throw installments.error
  if (payments.error) throw payments.error
  if (staff.error) throw staff.error
  return {
    installments: installments.data,
    payments: payments.data,
    staffNames: new Map(staff.data.map((s) => [s.user_id, s.display_name])),
  }
}

export async function recordPayment(args: { planId: string; amount: number; method: PaymentMethod; note: string }) {
  const { data, error } = await supabase.rpc('record_payment', {
    p_installment_plan_id: args.planId,
    p_amount: args.amount,
    p_method: args.method,
    p_note: args.note.trim() || undefined,
  })
  if (error) throw error
  return data as string
}

export async function reversePayment(paymentId: string, reason: string) {
  const { data, error } = await supabase.rpc('reverse_payment', { p_payment_id: paymentId, p_reason: reason.trim() })
  if (error) throw error
  return data as string
}

export async function getReceipt(paymentId: string) {
  const { data: payment, error } = await supabase.from('payments').select('*').eq('id', paymentId).maybeSingle()
  if (error) throw error
  if (!payment) return null

  const [clinic, patient, plan, summary, original, staff] = await Promise.all([
    supabase.from('clinics').select('name, currency').eq('id', payment.clinic_id).single(),
    supabase.from('patients').select('full_name, phone').eq('id', payment.patient_id).single(),
    payment.treatment_plan_id
      ? supabase.from('treatment_plans').select('title').eq('id', payment.treatment_plan_id).single()
      : Promise.resolve({ data: null, error: null }),
    payment.installment_plan_id
      ? supabase.from('installment_plan_summary').select('outstanding')
          .eq('installment_plan_id', payment.installment_plan_id).single()
      : Promise.resolve({ data: null, error: null }),
    payment.reverses_payment_id
      ? supabase.from('payments').select('receipt_no').eq('id', payment.reverses_payment_id).single()
      : Promise.resolve({ data: null, error: null }),
    payment.received_by
      ? supabase.from('clinic_members').select('display_name')
          .eq('clinic_id', payment.clinic_id).eq('user_id', payment.received_by).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  for (const r of [clinic, patient, plan, summary, original, staff]) if (r.error) throw r.error

  return {
    payment,
    clinicName: clinic.data?.name ?? '',
    patient: patient.data,
    planTitle: plan.data?.title ?? null,
    outstanding: summary.data?.outstanding ?? null,
    reversesReceiptNo: original.data?.receipt_no ?? null,
    receivedBy: staff.data?.display_name ?? null,
  }
}
