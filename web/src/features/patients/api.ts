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

export type PatientFilter = 'all' | 'overdue' | 'alerts' | 'new' | 'recall'
export type ListedPatient = PatientRow & Pick<Patient, 'date_of_birth' | 'primary_doctor_id' | 'created_at'> & {
  lastVisit: string | null
  nextAppointment: string | null
}
export const PAGE_SIZE = 25

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

async function overdueIds(clinicId: string): Promise<string[]> {
  const { data, error } = await supabase.from('patient_balance').select('patient_id')
    .eq('clinic_id', clinicId).gt('overdue_count', 0)
  if (error) throw error
  return [...new Set(data.map((r) => r.patient_id).filter((id): id is string => !!id))]
}

/** The patients list: one page, filtered, with balances, last visit and next appointment. */
export async function listPatients(clinicId: string, opts: {
  q: string; filter: PatientFilter; archived: boolean; page: number; pageSize?: number
}): Promise<{ rows: ListedPatient[]; total: number }> {
  const size = opts.pageSize ?? PAGE_SIZE
  let query = supabase.from('patients')
    .select('id, full_name, phone, medical_alerts, archived_at, date_of_birth, primary_doctor_id, created_at', { count: 'exact' })
    .eq('clinic_id', clinicId)
  if (!opts.archived) query = query.is('archived_at', null)

  if (opts.filter === 'alerts') query = query.not('medical_alerts', 'is', null).neq('medical_alerts', '')
  if (opts.filter === 'new') query = query.gte('created_at', daysAgo(30))
  if (opts.filter === 'recall') query = query.lte('next_recall_due', todayIso())
  if (opts.filter === 'overdue') {
    const ids = await overdueIds(clinicId)
    if (!ids.length) return { rows: [], total: 0 }
    query = query.in('id', ids)
  }

  const term = cleanSearch(opts.q)
  if (term) {
    const digits = term.replace(/\D/g, '')
    query = digits.length >= 3
      ? query.or(`full_name.ilike.%${term}%,phone.ilike.%${digits}%,whatsapp_phone.ilike.%${digits}%`)
      : query.ilike('full_name', `%${term}%`)
  }

  const from = opts.page * size
  const { data: patients, error, count } = await query.order('full_name').range(from, from + size - 1)
  if (error) throw error
  if (!patients.length) return { rows: [], total: count ?? 0 }
  const ids = patients.map((p) => p.id)

  const [balances, past, upcoming] = await Promise.all([
    supabase.from('patient_balance').select('patient_id, outstanding, overdue_count').in('patient_id', ids),
    supabase.from('appointments').select('patient_id, starts_at').in('patient_id', ids)
      .eq('status', 'done').order('starts_at', { ascending: false }).limit(500),
    supabase.from('appointments').select('patient_id, starts_at').in('patient_id', ids)
      .in('status', ['booked', 'arrived', 'in_session']).gte('starts_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
      .order('starts_at').limit(500),
  ])
  for (const r of [balances, past, upcoming]) if (r.error) throw r.error

  const totals = new Map<string, { outstanding: number; overdueCount: number }>()
  for (const b of balances.data ?? []) {
    if (b.patient_id) totals.set(b.patient_id, { outstanding: b.outstanding ?? 0, overdueCount: b.overdue_count ?? 0 })
  }
  const first = (rows: { patient_id: string; starts_at: string }[]) => {
    const m = new Map<string, string>()
    for (const r of rows) if (!m.has(r.patient_id)) m.set(r.patient_id, r.starts_at)
    return m
  }
  const last = first(past.data ?? []), next = first(upcoming.data ?? [])

  return {
    total: count ?? patients.length,
    rows: patients.map((p) => ({
      ...p,
      ...(totals.get(p.id) ?? { outstanding: 0, overdueCount: 0 }),
      lastVisit: last.get(p.id) ?? null,
      nextAppointment: next.get(p.id) ?? null,
    })),
  }
}

/** The numbers on the filter chips. */
export async function patientCounts(clinicId: string) {
  const base = () => supabase.from('patients').select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId).is('archived_at', null)
  const [all, alerts, fresh, recall, overdue] = await Promise.all([
    base(),
    base().not('medical_alerts', 'is', null).neq('medical_alerts', ''),
    base().gte('created_at', daysAgo(30)),
    base().lte('next_recall_due', todayIso()),
    overdueIds(clinicId),
  ])
  for (const r of [all, alerts, fresh, recall]) if (r.error) throw r.error
  return { all: all.count ?? 0, alerts: alerts.count ?? 0, new: fresh.count ?? 0, recall: recall.count ?? 0, overdue: overdue.length }
}
