import { supabase } from '../../lib/supabase'

export type PlanState = 'trial' | 'active' | 'past_due' | 'suspended'

export type Sub = {
  plan: string; price: number | null; state: PlanState; renews_on: string | null; trial_ends_on: string | null; today: string
  chairs: number; users: number; assistant_used: number; assistant_limit: number
}

export async function getSub(clinicId: string): Promise<Sub> {
  const { data, error } = await supabase.rpc('subscription_status', { p_clinic: clinicId })
  if (error) throw error
  return data as unknown as Sub
}

export async function getPlanState(clinicId: string): Promise<PlanState> {
  const { data, error } = await supabase.rpc('clinic_plan_state', { p_clinic: clinicId })
  if (error) throw error
  return (data as PlanState | null) ?? 'active'
}

/** Whole days from `today` to `date` (both YYYY-MM-DD, clinic time). */
export function daysBetween(today: string, date: string) {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5)
}
