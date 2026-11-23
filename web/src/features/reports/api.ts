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
    low: { id: string; patient: string; stars: number; comment: string | null; doctor: string | null; day: string; phone: string | null }[]
  }
}

export async function getReport(clinicId: string, from: string, to: string): Promise<Report> {
  const { data, error } = await supabase.rpc('clinic_report', { p_clinic: clinicId, p_from: from, p_to: to })
  if (error) throw error
  return data as unknown as Report
}
