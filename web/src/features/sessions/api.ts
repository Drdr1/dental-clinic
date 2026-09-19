import { supabase } from '../../lib/supabase'

export type NewSession = {
  patientId: string
  planId: string | null
  notes: string
  isRecallVisit: boolean
  doneItemIds: string[]
  override?: { reason: string }
}

/**
 * One database transaction: the session and the finished items are saved together or not at all.
 * A locked plan raises SESSION_LOCKED unless a doctor sends an override reason.
 */
export async function recordSession(s: NewSession) {
  const { data, error } = await supabase.rpc('record_session', {
    p_patient_id: s.patientId,
    p_notes: s.notes,
    p_is_recall_visit: s.isRecallVisit,
    p_treatment_plan_id: s.planId ?? undefined,
    p_done_item_ids: s.doneItemIds,
    p_override_reason: s.override?.reason.trim() || undefined,
  })
  if (error) throw error
  return data as string
}
