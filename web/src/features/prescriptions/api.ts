import { supabase } from '../../lib/supabase'

export type AllergyGroup = { code: string; label_ar: string; label_en: string }
export type Drug = {
  id: string; name: string; generic_name: string | null; form: string | null; allergy_group: string | null
  default_dose: string | null; default_frequency: string | null; default_duration: string | null; default_notes: string | null
  active: boolean
}
export type RxTemplate = { id: string; name: string; items: Array<{ drug_id: string; dose?: string; frequency?: string; duration?: string; notes?: string }> }
export type RxLine = { key: string; drug_id: string | null; drug_name: string; allergy_group: string | null; dose: string; frequency: string; duration: string; notes: string }
export type Conflict = { drug_id: string; drug_name: string; allergy_group: string; label_ar: string; label_en: string; source: 'listed' | 'mentioned' }

export async function getAllergyGroups(): Promise<AllergyGroup[]> {
  const { data, error } = await supabase.from('allergy_groups').select('code, label_ar, label_en').order('label_en')
  if (error) throw error
  return data
}

export async function getCatalog(clinicId: string) {
  const [drugs, templates] = await Promise.all([
    supabase.from('drugs').select('*').eq('clinic_id', clinicId).order('name'),
    supabase.from('prescription_templates').select('id, name, items').eq('clinic_id', clinicId).order('name'),
  ])
  if (drugs.error) throw drugs.error
  if (templates.error) throw templates.error
  return { drugs: drugs.data as Drug[], templates: templates.data as unknown as RxTemplate[] }
}

export async function getConflicts(patientId: string, drugIds: string[]): Promise<Conflict[]> {
  if (!drugIds.length) return []
  const { data, error } = await supabase.rpc('prescription_conflicts', { p_patient: patientId, p_drugs: drugIds })
  if (error) throw error
  return (data ?? []) as Conflict[]
}

export async function createPrescription(patientId: string, lines: RxLine[], notes: string, planId: string | null, override: string | null) {
  const items = lines.map((l) => ({
    ...(l.drug_id ? { drug_id: l.drug_id } : { drug_name: l.drug_name }),
    dose: l.dose, frequency: l.frequency, duration: l.duration, notes: l.notes,
  }))
  const { data, error } = await supabase.rpc('create_prescription', {
    p_patient_id: patientId, p_items: items as never, p_notes: notes || undefined,
    p_treatment_plan_id: planId ?? undefined, p_override_reason: override || undefined,
  })
  if (error) throw error
  return data as string
}

export async function saveTemplate(clinicId: string, name: string, lines: RxLine[]) {
  const items = lines.filter((l) => l.drug_id).map((l) => ({ drug_id: l.drug_id, dose: l.dose, frequency: l.frequency, duration: l.duration, notes: l.notes }))
  const { error } = await supabase.from('prescription_templates')
    .upsert({ clinic_id: clinicId, name: name.trim(), items: items as never }, { onConflict: 'clinic_id,name' })
  if (error) throw error
}

export async function getPatientPrescriptions(patientId: string) {
  const { data, error } = await supabase.from('prescriptions').select('id, prescribed_at, allergy_override_reason')
    .eq('patient_id', patientId).order('prescribed_at', { ascending: false }).limit(20)
  if (error) throw error
  const ids = data.map((p) => p.id)
  const items = ids.length
    ? await supabase.from('prescription_items').select('prescription_id, drug_name').in('prescription_id', ids).order('position')
    : { data: [], error: null }
  if (items.error) throw items.error
  return data.map((p) => ({ ...p, drugs: (items.data ?? []).filter((i) => i.prescription_id === p.id).map((i) => i.drug_name) }))
}

export async function getPrescription(id: string) {
  const { data: rx, error } = await supabase.from('prescriptions').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!rx) return null
  const [items, patient, clinic, doctor] = await Promise.all([
    supabase.from('prescription_items').select('*').eq('prescription_id', id).order('position'),
    supabase.from('patients').select('full_name, date_of_birth, phone').eq('id', rx.patient_id).single(),
    supabase.from('clinics').select('name').eq('id', rx.clinic_id).single(),
    supabase.from('clinic_members').select('display_name').eq('clinic_id', rx.clinic_id).eq('user_id', rx.prescribed_by).maybeSingle(),
  ])
  for (const r of [items, patient, clinic, doctor]) if (r.error) throw r.error
  return { rx, items: items.data ?? [], patient: patient.data, clinicName: clinic.data?.name ?? '', doctor: doctor.data?.display_name ?? '' }
}

export async function setPatientAllergies(patientId: string, groups: string[]) {
  const { error } = await supabase.from('patients').update({ allergy_groups: groups }).eq('id', patientId)
  if (error) throw error
}

export async function saveDrug(clinicId: string, d: Partial<Drug> & { name: string }) {
  const row = {
    name: d.name.trim(), generic_name: d.generic_name?.trim() || null, form: d.form?.trim() || null,
    allergy_group: d.allergy_group || null, default_dose: d.default_dose?.trim() || null,
    default_frequency: d.default_frequency?.trim() || null, default_duration: d.default_duration?.trim() || null,
    default_notes: d.default_notes?.trim() || null, active: d.active ?? true,
  }
  const { error } = d.id
    ? await supabase.from('drugs').update(row).eq('id', d.id)
    : await supabase.from('drugs').insert({ ...row, clinic_id: clinicId })
  if (error) throw error
}
