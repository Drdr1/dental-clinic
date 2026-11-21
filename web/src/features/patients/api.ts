import { supabase } from '../../lib/supabase'
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database'

export type Patient = Tables<'patients'>
export type PlanSummary = Tables<'installment_plan_summary'>
export type PlanOverview = Tables<'treatment_plan_overview'>
export type PlanBalance = Tables<'treatment_plan_balance'>

export type PatientRow = Pick<Patient, 'id' | 'full_name' | 'phone' | 'medical_alerts' | 'archived_at'> & {
  outstanding: number
  overdueCount: number
}

/** PostgREST `or()` filters are comma/paren separated, so strip those from user input. */
function cleanSearch(q: string) {
  return q.replace(/[,()*%\\]/g, ' ').trim()
}

export async function searchPatients(clinicId: string, q: string, includeArchived = false): Promise<PatientRow[]> {
  let query = supabase
    .from('patients')
    .select('id, full_name, phone, medical_alerts, archived_at')
    .eq('clinic_id', clinicId)

  // Archived patients stay out of lists and search unless explicitly asked for.
  if (!includeArchived) query = query.is('archived_at', null)
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

export type Payer = { id: string; name: string; discount_percent: number }

export async function getPayers(clinicId: string): Promise<Payer[]> {
  const { data, error } = await supabase.from('payers').select('id, name, discount_percent')
    .eq('clinic_id', clinicId).eq('active', true).order('name')
  if (error) throw error
  return data
}

export async function updatePatient(id: string, values: TablesUpdate<'patients'>) {
  const { error } = await supabase.from('patients').update(values).eq('id', id)
  if (error) throw error
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

export type RecordCounts = Record<'sessions' | 'payments' | 'plans' | 'prescriptions' | 'files' | 'forms' | 'lab_cases' | 'appointments', number>

export async function getRecordCounts(patientId: string): Promise<RecordCounts> {
  const { data, error } = await supabase.rpc('patient_record_counts', { p_patient: patientId })
  if (error) throw error
  return data as unknown as RecordCounts
}

export async function archivePatient(patientId: string, reason: string, archive = true) {
  const { error } = await supabase.rpc('archive_patient', {
    p_patient: patientId, p_reason: reason.trim() || undefined, p_archive: archive,
  })
  if (error) throw error
}

/** Returns the storage paths of the patient's files so the caller can remove them. */
export async function deletePatient(patientId: string, force = false, reason = '') {
  const { data, error } = await supabase.rpc('delete_patient', {
    p_patient: patientId, p_force: force, p_reason: reason.trim() || undefined,
  })
  if (error) throw error
  const paths = ((data as { storage_paths?: string[] } | null)?.storage_paths) ?? []
  if (paths.length) await supabase.storage.from('patient-files').remove(paths)
}

export type DeletedPatient = {
  id: string; full_name: string; phone: string | null
  counts: Record<string, number>; reason: string | null; deleted_at: string
}

export async function getDeletedPatients(clinicId: string): Promise<DeletedPatient[]> {
  const { data, error } = await supabase.from('deleted_patients')
    .select('id, full_name, phone, counts, reason, deleted_at')
    .eq('clinic_id', clinicId).order('deleted_at', { ascending: false }).limit(100)
  if (error) throw error
  return data as unknown as DeletedPatient[]
}

/** A doctor's own patients: assigned to them, or treated by them. */
export async function searchMyPatients(clinicId: string, doctorId: string, q: string): Promise<PatientRow[]> {
  const { data, error } = await supabase.rpc('doctor_patients', { p_clinic: clinicId, p_doctor: doctorId })
  if (error) throw error
  const rows = (data ?? []) as Array<{
    patient_id: string; full_name: string; phone: string; outstanding: number
  }>
  const term = cleanSearch(q).toLowerCase()
  const digits = term.replace(/\D/g, '')
  return rows
    .filter((r) => !term
      || r.full_name.toLowerCase().includes(term)
      || (digits.length >= 3 && (r.phone ?? '').includes(digits)))
    .map((r) => ({
      id: r.patient_id, full_name: r.full_name, phone: r.phone,
      medical_alerts: null, archived_at: null,
      outstanding: r.outstanding ?? 0, overdueCount: 0,
    }))
}
