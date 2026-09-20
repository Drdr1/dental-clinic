import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'

export type LabCase = Tables<'lab_case_status'>
export type Lab = { id: string; name: string; phone: string | null }
export type LabFilter = 'open' | 'received' | 'done'

export async function getLabs(clinicId: string): Promise<Lab[]> {
  const { data, error } = await supabase.from('labs').select('id, name, phone')
    .eq('clinic_id', clinicId).eq('active', true).order('name')
  if (error) throw error
  return data
}

export async function addLab(clinicId: string, name: string, phone: string) {
  const { data, error } = await supabase.from('labs')
    .insert({ clinic_id: clinicId, name: name.trim(), phone: phone.trim() || null })
    .select('id, name, phone').single()
  if (error) throw error
  return data as Lab
}

export async function getCases(clinicId: string, filter: LabFilter): Promise<LabCase[]> {
  let q = supabase.from('lab_case_status').select('*').eq('clinic_id', clinicId).is('cancelled_at', null)
  if (filter === 'open') q = q.is('received_on', null).order('expected_on')
  if (filter === 'received') q = q.not('received_on', 'is', null).is('fitted_on', null).order('received_on')
  if (filter === 'done') q = q.not('fitted_on', 'is', null).order('fitted_on', { ascending: false }).limit(50)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function getPatientCases(patientId: string): Promise<LabCase[]> {
  const { data, error } = await supabase.from('lab_case_status').select('*')
    .eq('patient_id', patientId).is('cancelled_at', null).is('fitted_on', null).order('expected_on')
  if (error) throw error
  return data
}

/** Planned procedures on the patient's open plans, to link a lab case to the exact tooth/crown. */
export async function getOpenItems(patientId: string) {
  const { data: plans, error } = await supabase.from('treatment_plans').select('id, title')
    .eq('patient_id', patientId).in('status', ['draft', 'presented', 'active'])
  if (error) throw error
  if (!plans.length) return []
  const [items, procedures] = await Promise.all([
    supabase.from('treatment_plan_items').select('id, plan_id, procedure_id, tooth_number, description')
      .in('plan_id', plans.map((p) => p.id)).eq('status', 'planned').order('created_at'),
    supabase.from('procedures').select('id, name'),
  ])
  if (items.error) throw items.error
  if (procedures.error) throw procedures.error
  const names = new Map(procedures.data.map((p) => [p.id, p.name]))
  const titles = new Map(plans.map((p) => [p.id, p.title]))
  return items.data.map((i) => ({
    id: i.id,
    planTitle: titles.get(i.plan_id) ?? '',
    label: [i.procedure_id ? names.get(i.procedure_id) : null, i.description].filter(Boolean).join(' — '),
    tooth: i.tooth_number,
  }))
}

export type NewLabCase = {
  clinicId: string
  patientId: string
  labId: string
  planItemId: string | null
  description: string
  shade: string
  labFee: number | null
  sentOn: string
  expectedOn: string
  notes: string
}

export async function createCase(c: NewLabCase) {
  const { error } = await supabase.from('lab_cases').insert({
    clinic_id: c.clinicId,
    patient_id: c.patientId,
    lab_id: c.labId,
    plan_item_id: c.planItemId,
    description: c.description.trim(),
    shade: c.shade.trim() || null,
    lab_fee: c.labFee,
    sent_on: c.sentOn,
    expected_on: c.expectedOn,
    notes: c.notes.trim() || null,
  })
  if (error) throw error
}

export async function updateCase(
  id: string,
  patch: { received_on?: string | null; fitted_on?: string | null; expected_on?: string; cancelled_at?: string },
) {
  const { error } = await supabase.from('lab_cases').update(patch).eq('id', id)
  if (error) throw error
}
