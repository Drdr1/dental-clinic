import { supabase } from '../../lib/supabase'

export type Report = {
  new_patients: number
  prev_new_patients: number
  sources: { source: string; patients: number; collected: number }[]
  plans: {
    presented: number; presented_value: number
    accepted: number; accepted_value: number
    pending: number; pending_value: number
    declined: number; declined_value: number
  }
  decline_reasons: { reason: string; n: number }[]
  appointments: { total: number; online: number; done: number; cancelled: number; no_show: number }
  worked_days: number
  chairs: { name: string; pct: number }[]
  hours: { hour: number; n: number }[]
  doctors: { user_id: string; name: string; done: number; no_show: number; presented: number; accepted: number; rating?: number | null }[]
  reviews?: {
    avg: number | null; count: number; requested: number
    dist: Record<string, number>; google: number; follow_up: number
    low: { id: string; patient: string; stars: number; comment: string | null; doctor: string | null; at: string; phone: string | null }[]
    by_doctor: Record<string, number>
  }
}

export async function getReport(clinicId: string, from: string, to: string): Promise<Report> {
  const args = { p_clinic: clinicId, p_from: from, p_to: to }
  const [main, rev] = await Promise.all([supabase.rpc('clinic_report', args), supabase.rpc('clinic_report_reviews', args)])
  if (main.error) throw main.error
  if (rev.error) throw rev.error
  const r = main.data as unknown as Report
  const reviews = rev.data as unknown as NonNullable<Report['reviews']>
  return {
    ...r,
    reviews,
    doctors: r.doctors.map((d) => ({ ...d, rating: reviews.by_doctor[d.user_id] ?? null })),
  }
}
