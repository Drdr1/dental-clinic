import { supabase } from '../../lib/supabase'

export type NewSession = {
  clinicId: string
  patientId: string
  planId: string | null
  notes: string
  isRecallVisit: boolean
  doneItemIds: string[]
  override?: { reason: string }
}

/**
 * Inserts the session; the database blocks it if the plan is locked (SESSION_LOCKED)
 * unless a doctor sends an override with a reason. Then marks the finished items.
 */
export async function recordSession(s: NewSession) {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      clinic_id: s.clinicId,
      patient_id: s.patientId,
      treatment_plan_id: s.planId,
      notes: s.notes.trim() || null,
      is_recall_visit: s.isRecallVisit,
      lock_override: !!s.override,
      override_reason: s.override?.reason.trim() || null,
    })
    .select('id')
    .single()
  if (error) throw error

  if (s.doneItemIds.length) {
    const { error: itemsError } = await supabase
      .from('treatment_plan_items')
      .update({ status: 'done', done_in_session_id: data.id })
      .in('id', s.doneItemIds)
    if (itemsError) throw itemsError
  }
  return data.id
}
