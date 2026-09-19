import { supabase } from '../../lib/supabase'
import type { Tables, TablesInsert } from '../../types/database'

export type Patient = Tables<'patients'>
export type PlanSummary = Tables<'installment_plan_summary'>
export type PlanOverview = Tables<'treatment_plan_overview'>
export type PlanBalance = Tables<'treatment_plan_balance'>

export type PatientRow = Pick<Patient, 'id' | 'full_name' | 'phone' | 'medical_alerts'> & {
  outstanding: number
  overdueCount: number
}

/** PostgREST `or()` filters are comma/paren separated, so strip those from user input. */
function cleanSearch(q: string) {
  return q.replace(/[,()*%\\]/g, ' ').trim()
}

export async function searchPatients(clinicId: string, q: string): Promise<PatientRow[]> {
  let query = supabase
    .from('patients')
    .select('id, full_name, phone, medical_alerts')
    .eq('clinic_id', clinicId)
    .order('full_name')
    .limit(50)

  const term = cleanSearch(q)
  if (term) {
    const digits = term.replace(/\D/g, '')
    query = digits.length >= 3
      ? query.or(`full_name.ilike.%${term}%,phone.ilike.%${digits}%,whatsapp_phone.ilike.%${digits}%`)
      : query.ilike('full_name', `%${term}%`)
  }

  const { data: patients, error } = await query
  if (error) throw error
  if (!patients.length) return []

  // Balances for the patients on screen, in one query: installments and pay-per-session together.
  const { data: balances, error: balancesError } = await supabase
    .from('patient_balance')
    .select('patient_id, outstanding, overdue_count')
    .in('patient_id', patients.map((p) => p.id))
  if (balancesError) throw balancesError

  const totals = new Map<string, { outstanding: number; overdueCount: number }>()
  for (const b of balances) {
    if (b.patient_id) totals.set(b.patient_id, { outstanding: b.outstanding ?? 0, overdueCount: b.overdue_count ?? 0 })
  }

  return patients.map((p) => ({ ...p, ...(totals.get(p.id) ?? { outstanding: 0, overdueCount: 0 }) }))
}

export async function findByPhone(clinicId: string, phone: string) {
  const { data, error } = await supabase
    .from('patients')
    .select('id, full_name')
    .eq('clinic_id', clinicId)
    .eq('phone', phone)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createPatient(values: TablesInsert<'patients'>) {
  const { data, error } = await supabase.from('patients').insert(values).select('id').single()
  if (error) throw error
  return data.id
}

export async function getPatientFile(patientId: string) {
  const [patient, plans, balances, perSession] = await Promise.all([
    supabase.from('patients').select('*').eq('id', patientId).maybeSingle(),
    supabase.from('treatment_plan_overview').select('*').eq('patient_id', patientId)
      .order('presented_at', { ascending: false, nullsFirst: true }),
    supabase.from('installment_plan_summary').select('*').eq('patient_id', patientId).eq('status', 'active'),
    supabase.from('treatment_plan_balance').select('*').eq('patient_id', patientId)
      .eq('billing', 'per_session').gt('outstanding', 0),
  ])
  if (patient.error) throw patient.error
  if (plans.error) throw plans.error
  if (balances.error) throw balances.error
  if (perSession.error) throw perSession.error
  return { patient: patient.data, plans: plans.data, balances: balances.data, perSession: perSession.data }
}
