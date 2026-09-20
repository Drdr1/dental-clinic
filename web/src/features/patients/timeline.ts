import { supabase } from '../../lib/supabase'

export type EventKind = 'session' | 'prescription' | 'lab_sent' | 'lab_fitted' | 'form' | 'plan'
export type TimelineEvent = {
  id: string
  at: string
  kind: EventKind
  title: string
  details: string[]
  warn?: string
  link?: string
}

/** Everything clinical that happened to this patient, newest first. */
export async function getTimeline(patientId: string): Promise<TimelineEvent[]> {
  const [sessions, plans, prescriptions, labs, forms] = await Promise.all([
    supabase.from('sessions').select('id, performed_at, notes, treatment_plan_id, is_recall_visit, lock_override, override_reason')
      .eq('patient_id', patientId).order('performed_at', { ascending: false }).limit(60),
    supabase.from('treatment_plans').select('id, title, created_at, status').eq('patient_id', patientId),
    supabase.from('prescriptions').select('id, prescribed_at, allergy_override_reason').eq('patient_id', patientId)
      .order('prescribed_at', { ascending: false }).limit(30),
    supabase.from('lab_case_status').select('id, description, lab_name, sent_on, received_on, fitted_on, cancelled_at')
      .eq('patient_id', patientId).order('sent_on', { ascending: false }).limit(30),
    supabase.from('form_submissions').select('id, template_id, signed_at').eq('patient_id', patientId)
      .order('signed_at', { ascending: false }).limit(20),
  ])
  for (const r of [sessions, plans, prescriptions, labs, forms]) if (r.error) throw r.error

  const sessionIds = (sessions.data ?? []).map((s) => s.id)
  const rxIds = (prescriptions.data ?? []).map((p) => p.id)
  const templateIds = [...new Set((forms.data ?? []).map((f) => f.template_id))]
  const [doneItems, rxItems, procedures, templates] = await Promise.all([
    sessionIds.length
      ? supabase.from('treatment_plan_items').select('done_in_session_id, procedure_id, tooth_number, description').in('done_in_session_id', sessionIds)
      : Promise.resolve({ data: [], error: null }),
    rxIds.length
      ? supabase.from('prescription_items').select('prescription_id, drug_name').in('prescription_id', rxIds).order('position')
      : Promise.resolve({ data: [], error: null }),
    supabase.from('procedures').select('id, name'),
    templateIds.length
      ? supabase.from('form_templates').select('id, title').in('id', templateIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of [doneItems, rxItems, procedures, templates]) if (r.error) throw r.error

  const procName = new Map((procedures.data ?? []).map((p) => [p.id, p.name]))
  const planTitle = new Map((plans.data ?? []).map((p) => [p.id, p.title]))
  const templateTitle = new Map((templates.data ?? []).map((x) => [x.id, x.title]))

  const events: TimelineEvent[] = []

  for (const s of (sessions.data ?? [])) {
    const done = (doneItems.data ?? []).filter((i) => i.done_in_session_id === s.id)
      .map((i) => [i.procedure_id ? procName.get(i.procedure_id) : null, i.description, i.tooth_number ? `#${i.tooth_number}` : null]
        .filter(Boolean).join(' '))
    events.push({
      id: `s-${s.id}`, at: s.performed_at, kind: 'session',
      title: s.is_recall_visit ? 'timeline.checkup' : 'timeline.session',
      details: [...done, s.notes, s.treatment_plan_id ? planTitle.get(s.treatment_plan_id) ?? null : null].filter(Boolean) as string[],
      warn: s.lock_override ? (s.override_reason ?? '') : undefined,
      link: s.treatment_plan_id ? `/plans/${s.treatment_plan_id}` : undefined,
    })
  }
  for (const p of (prescriptions.data ?? [])) {
    events.push({
      id: `r-${p.id}`, at: p.prescribed_at, kind: 'prescription', title: 'timeline.prescription',
      details: (rxItems.data ?? []).filter((i) => i.prescription_id === p.id).map((i) => i.drug_name),
      warn: p.allergy_override_reason ?? undefined,
      link: `/prescriptions/${p.id}`,
    })
  }
  for (const l of (labs.data ?? [])) {
    if (l.cancelled_at) continue
    events.push({ id: `l-${l.id}`, at: `${l.sent_on}T09:00:00`, kind: 'lab_sent', title: 'timeline.labSent',
      details: [l.description, l.lab_name].filter(Boolean) as string[] })
    if (l.fitted_on) {
      events.push({ id: `lf-${l.id}`, at: `${l.fitted_on}T09:00:00`, kind: 'lab_fitted', title: 'timeline.labFitted',
        details: [l.description].filter(Boolean) as string[] })
    }
  }
  for (const f of (forms.data ?? [])) {
    events.push({ id: `f-${f.id}`, at: f.signed_at, kind: 'form', title: 'timeline.form',
      details: [templateTitle.get(f.template_id) ?? ''].filter(Boolean) })
  }
  for (const p of (plans.data ?? [])) {
    events.push({ id: `p-${p.id}`, at: p.created_at, kind: 'plan', title: 'timeline.plan',
      details: [p.title], link: `/plans/${p.id}` })
  }

  return events.filter((e) => !!e.at).sort((a, b) => b.at.localeCompare(a.at))
}
