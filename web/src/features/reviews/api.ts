import { supabase } from '../../lib/supabase'

export type PublicReview = {
  clinic: string
  logo_url: string | null
  patient: string
  doctor: string | null
  expired: boolean
  rating: number | null
  google_url: string | null
  whatsapp: string | null
}

export async function getReview(token: string): Promise<PublicReview | null> {
  const { data, error } = await supabase.rpc('get_review', { p_token: token })
  if (error) throw error
  return data as unknown as PublicReview | null
}

export async function submitReview(token: string, rating: number, comment: string): Promise<PublicReview> {
  const { data, error } = await supabase.rpc('submit_review', { p_token: token, p_rating: rating, p_comment: comment })
  if (error) throw error
  return data as unknown as PublicReview
}

export async function wentToGoogle(token: string) {
  await supabase.rpc('review_to_google', { p_token: token })
}

/** Staff: the one-time link for a finished visit (made on first use). */
export async function requestReview(appointmentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('request_review', { p_appointment: appointmentId })
  if (error) throw error
  return `${window.location.origin}/r/${data as string}`
}

export async function resolveReview(id: string) {
  const { error } = await supabase.rpc('resolve_review', { p_id: id })
  if (error) throw error
}

export type ReviewRow = {
  id: string; appointment_id: string; patient_id: string; doctor_id: string | null
  rating: number | null; comment: string | null; answered_at: string | null; resolved_at: string | null; created_at: string
}

export async function getReviewsFor(clinicId: string, appointmentIds: string[]): Promise<ReviewRow[]> {
  if (appointmentIds.length === 0) return []
  const { data, error } = await supabase.from('review_requests')
    .select('id, appointment_id, patient_id, doctor_id, rating, comment, answered_at, resolved_at, created_at')
    .eq('clinic_id', clinicId).in('appointment_id', appointmentIds)
  if (error) throw error
  return data as ReviewRow[]
}

export type FollowUp = ReviewRow & { patients: { full_name: string; phone: string } | null }

export async function getFollowUps(clinicId: string): Promise<FollowUp[]> {
  const { data, error } = await supabase.from('review_requests')
    .select('id, appointment_id, patient_id, doctor_id, rating, comment, answered_at, resolved_at, created_at, patients(full_name, phone)')
    .eq('clinic_id', clinicId).lte('rating', 3).is('resolved_at', null)
    .order('answered_at', { ascending: false }).limit(20)
  if (error) throw error
  return data as unknown as FollowUp[]
}
