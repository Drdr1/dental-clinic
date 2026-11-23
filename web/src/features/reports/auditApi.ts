import { supabase } from '../../lib/supabase'

export type AuditCategory = 'money' | 'appointments' | 'patients' | 'plans' | 'team'
export const AUDIT_CATEGORIES: AuditCategory[] = ['money', 'appointments', 'patients', 'plans', 'team']

export type AuditRow = {
  id: number
  at: string
  actor: string | null
  actor_name: string | null
  actor_role: 'owner' | 'doctor' | 'receptionist' | null
  category: AuditCategory
  action: string
  sensitive: boolean
  patient_id: string | null
  patient_name: string | null
  data: Record<string, unknown>
}

export type AuditFilter = { category: AuditCategory | null; sensitive: boolean; actor: string | null }

export const PAGE = 40

export async function getAudit(clinicId: string, f: AuditFilter, before: string | null, limit = PAGE): Promise<AuditRow[]> {
  let q = supabase.from('audit_log')
    .select('id, at, actor, actor_name, actor_role, category, action, sensitive, patient_id, patient_name, data')
    .eq('clinic_id', clinicId)
    .order('at', { ascending: false }).order('id', { ascending: false })
    .limit(limit)
  if (f.category) q = q.eq('category', f.category)
  if (f.sensitive) q = q.eq('sensitive', true)
  if (f.actor === 'none') q = q.is('actor', null)
  else if (f.actor) q = q.eq('actor', f.actor)
  if (before) q = q.lt('at', before)
  const { data, error } = await q
  if (error) throw error
  return data as unknown as AuditRow[]
}

export type AuditWeek = {
  total: number
  sensitive: number
  people: { actor: string | null; name: string; n: number; sensitive: number }[]
}

export async function getAuditWeek(clinicId: string): Promise<AuditWeek> {
  const { data, error } = await supabase.rpc('audit_week', { p_clinic: clinicId })
  if (error) throw error
  return data as unknown as AuditWeek
}
