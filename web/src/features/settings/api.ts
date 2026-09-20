import { supabase } from '../../lib/supabase'

export type ClinicSettings = {
  name: string
  cash_float: number
  commission_basis: string
  grace_days: number
  lock_threshold: number
  opens_at: string
  closes_at: string
  slot_minutes: number
}

export async function getSettings(clinicId: string) {
  const [clinic, procedures, chairs] = await Promise.all([
    supabase.from('clinics').select('name, cash_float, commission_basis, grace_days, lock_threshold, opens_at, closes_at, slot_minutes').eq('id', clinicId).single(),
    supabase.from('procedures').select('id, name, default_price, default_duration_min, active').eq('clinic_id', clinicId).order('name'),
    supabase.from('chairs').select('id, name, active').eq('clinic_id', clinicId).order('name'),
  ])
  for (const r of [clinic, procedures, chairs]) if (r.error) throw r.error
  return { clinic: clinic.data!, procedures: procedures.data ?? [], chairs: chairs.data ?? [] }
}

export async function saveClinic(clinicId: string, s: ClinicSettings) {
  const { data, error } = await supabase.from('clinics').update(s).eq('id', clinicId).select('id')
  if (error) throw error
  if (!data.length) throw new Error('Only the clinic owner can change settings')
}

export async function saveProcedure(
  clinicId: string,
  p: { id?: string; name: string; default_price: number; default_duration_min: number; active: boolean },
) {
  const row = { name: p.name.trim(), default_price: p.default_price, default_duration_min: p.default_duration_min, active: p.active }
  const { error } = p.id
    ? await supabase.from('procedures').update(row).eq('id', p.id)
    : await supabase.from('procedures').insert({ ...row, clinic_id: clinicId })
  if (error) throw error
}

export async function saveChair(clinicId: string, c: { id?: string; name: string; active: boolean }) {
  const row = { name: c.name.trim(), active: c.active }
  const { error } = c.id
    ? await supabase.from('chairs').update(row).eq('id', c.id)
    : await supabase.from('chairs').insert({ ...row, clinic_id: clinicId })
  if (error) throw error
}

export type TeamMember = {
  user_id: string
  display_name: string
  role: 'owner' | 'doctor' | 'receptionist'
  active: boolean
  commission_percent?: number
  email: string
  last_sign_in: string | null
  created_at: string
}

export async function getTeam(clinicId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase.rpc('clinic_team', { p_clinic: clinicId })
  if (error) throw error
  return (data ?? []) as TeamMember[]
}

export async function updateMember(
  clinicId: string,
  userId: string,
  patch: { role?: 'doctor' | 'receptionist'; active?: boolean; commission_percent?: number },
) {
  const { data, error } = await supabase.from('clinic_members').update(patch)
    .eq('clinic_id', clinicId).eq('user_id', userId).select('user_id')
  if (error) throw error
  if (!data.length) throw new Error('Only the clinic owner can change the team')
}

/** Calls the `staff` Edge Function; account creation needs the secret key, which stays on the server. */
async function staff(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('staff', { body })
  if (error) {
    // Surface the function's own error code (e.g. email_taken) instead of a generic HTTP error.
    const ctx = (error as { context?: Response }).context
    const payload = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    throw new Error(payload?.error?.code ?? error.message)
  }
  return data
}

export const createStaff = (clinicId: string, s: { email: string; password: string; display_name: string; role: string }) =>
  staff({ action: 'create', clinic_id: clinicId, ...s })

export const setStaffPassword = (clinicId: string, userId: string, password: string) =>
  staff({ action: 'set_password', clinic_id: clinicId, user_id: userId, password })
