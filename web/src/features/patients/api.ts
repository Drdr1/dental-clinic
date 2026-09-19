import { supabase } from '../../lib/supabase'
import type { Tables, TablesInsert } from '../../types/database'

export type Patient = Tables<'patients'>
export type PlanSummary = Tables<'installment_plan_summary'>
export type PlanOverview = Tables<'treatment_plan_overview'>

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

  // Balances for the patients on screen, in one query.
  const { data: plans, error: plansError } = await supabase
    .from('installment_plan_summary')
    .select('patient_id, outstanding, overdue_count')
    .eq('status', 'active')
    .in('patient_id', patients.map((p) => p.id))
  if (plansError) throw plansError

  const totals = new Map<string, { outstanding: number; overdueCount: number }>()
  for (const plan of plans) {
    if (!plan.patient_id) continue
    const cur = totals.get(plan.patient_id) ?? { outstanding: 0, overdueCount: 0 }
    cur.outstanding += plan.outstanding ?? 0
    cur.overdueCount += plan.overdue_count ?? 0
    totals.set(plan.patient_id, cur)
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
  const [patient, plans, balances] = await Promise.all([
    supabase.from('patients').select('*').eq('id', patientId).maybeSingle(),
    supabase.from('treatment_plan_overview').select('*').eq('patient_id', patientId)
      .order('presented_at', { ascending: false, nullsFirst: true }),
    supabase.from('installment_plan_summary').select('*').eq('patient_id', patientId).eq('status', 'active'),
  ])
  if (patient.error) throw patient.error
  if (plans.error) throw plans.error
  if (balances.error) throw balances.error
  return { patient: patient.data, plans: plans.data, balances: balances.data }
}
