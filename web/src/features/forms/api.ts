import { supabase } from '../../lib/supabase'

export type Question =
  | { id: string; type: 'text'; label_ar?: string; label_en?: string }
  | { id: string; type: 'yesno'; label_ar?: string; label_en?: string }
  | { id: string; type: 'multi'; label_ar?: string; label_en?: string; options: Array<string | { value: string; label_ar?: string; label_en?: string }> }

export type TemplateBody = { questions?: Question[]; text_ar?: string; text_en?: string }

export type PublicForm = {
  clinic: string
  logo: string | null
  patient_first_name: string
  kind: 'medical_history' | 'consent'
  title: string
  body: TemplateBody
  expires_at: string
}

export async function getTemplates(clinicId: string) {
  const { data, error } = await supabase.from('form_templates').select('id, kind, title, version')
    .eq('clinic_id', clinicId).eq('active', true).order('kind').order('title')
  if (error) throw error
  return data
}

export async function createRequest(patientId: string, templateId: string, planId: string | null) {
  const { data, error } = await supabase.rpc('create_form_request', {
    p_patient_id: patientId, p_template_id: templateId, p_treatment_plan_id: planId ?? undefined,
  })
  if (error) throw error
  return data as string
}

export async function getPatientForms(patientId: string) {
  const [subs, pending] = await Promise.all([
    supabase.from('form_submissions').select('id, template_id, treatment_plan_id, signed_by_name, signed_at')
      .eq('patient_id', patientId).order('signed_at', { ascending: false }),
    supabase.from('form_requests').select('id, template_id, expires_at, created_at')
      .eq('patient_id', patientId).is('completed_at', null).gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
  ])
  if (subs.error) throw subs.error
  if (pending.error) throw pending.error
  const ids = [...new Set([...subs.data, ...pending.data].map((r) => r.template_id))]
  const templates = ids.length
    ? await supabase.from('form_templates').select('id, kind, title, version').in('id', ids)
    : { data: [], error: null }
  if (templates.error) throw templates.error
  const byId = new Map((templates.data ?? []).map((t) => [t.id, t]))
  return {
    submissions: subs.data.map((s) => ({ ...s, template: byId.get(s.template_id) })),
    pending: pending.data.map((p) => ({ ...p, template: byId.get(p.template_id) })),
  }
}

export async function getSubmission(id: string) {
  const { data, error } = await supabase.from('form_submissions').select('*').eq('id', id).single()
  if (error) throw error
  const { data: template, error: tErr } = await supabase.from('form_templates').select('kind, title, version, body')
    .eq('id', data.template_id).single()
  if (tErr) throw tErr
  return { submission: data, template: { ...template, body: template.body as TemplateBody } }
}

/** Anonymous: the patient opening the link. */
export async function loadPublicForm(token: string): Promise<PublicForm> {
  const { data, error } = await supabase.rpc('get_form_by_token', { p_token: token })
  if (error) throw error
  return data as unknown as PublicForm
}

export async function submitPublicForm(token: string, answers: Record<string, unknown>, name: string, signature: string) {
  const { error } = await supabase.rpc('submit_form', {
    p_token: token, p_answers: answers as never, p_signed_by_name: name.trim(), p_signature_data: signature,
  })
  if (error) throw error
}

// Labels for the option keys used in the default medical-history template.
export const OPTION_LABELS: Record<string, { ar: string; en: string }> = {
  diabetes: { ar: 'سكر', en: 'Diabetes' },
  hypertension: { ar: 'ضغط', en: 'High blood pressure' },
  heart_disease: { ar: 'أمراض قلب', en: 'Heart disease' },
  bleeding_disorder: { ar: 'سيولة أو مشاكل نزيف', en: 'Bleeding disorder' },
  none: { ar: 'لا شيء مما سبق', en: 'None of these' },
}
