import { supabase } from '../../lib/supabase'
import type { PaymentMethod } from '../payments/api'

export type Doctor = {
  user_id: string
  display_name: string
  role: 'owner' | 'doctor' | 'receptionist'
  active: boolean
  specialty: string | null
  phone: string | null
  registration_no: string | null
  work_days: number[]
  works_from: string | null
  works_to: string | null
  percent: number
  sessions: number
  patients: number
  work_value: number
  collected: number
  earned: number
  paid_in_period: number
  paid_all_time: number
  appointments: number
}

export async function getDoctors(clinicId: string, from: string, to: string): Promise<Doctor[]> {
  const { data, error } = await supabase.rpc('doctor_overview', { p_clinic: clinicId, p_from: from, p_to: to })
  if (error) throw error
  return (data ?? []) as Doctor[]
}

export async function saveDoctorProfile(clinicId: string, userId: string, p: {
  specialty: string; phone: string; registration_no: string
  work_days: number[]; works_from: string; works_to: string
}) {
  const { error } = await supabase.from('clinic_members').update({
    specialty: p.specialty.trim() || null,
    phone: p.phone.trim() || null,
    registration_no: p.registration_no.trim() || null,
    work_days: p.work_days,
    works_from: p.works_from || null,
    works_to: p.works_to || null,
  }).eq('clinic_id', clinicId).eq('user_id', userId)
  if (error) throw error
}

export async function recordPayout(a: {
  clinicId: string; userId: string; amount: number; method: PaymentMethod
  paidOn: string; from?: string; to?: string; note: string
}) {
  const { error } = await supabase.rpc('record_doctor_payout', {
    p_clinic: a.clinicId, p_user: a.userId, p_amount: a.amount, p_method: a.method,
    p_paid_on: a.paidOn, p_period_from: a.from, p_period_to: a.to, p_note: a.note.trim() || undefined,
  })
  if (error) throw error
}

export type Payout = {
  id: string; paid_on: string; amount: number; method: string
  period_from: string | null; period_to: string | null; note: string | null
}

export async function getPayouts(clinicId: string, userId: string): Promise<Payout[]> {
  const { data, error } = await supabase.from('doctor_payouts')
    .select('id, paid_on, amount, method, period_from, period_to, note')
    .eq('clinic_id', clinicId).eq('user_id', userId)
    .order('paid_on', { ascending: false }).limit(50)
  if (error) throw error
  return data as Payout[]
}
