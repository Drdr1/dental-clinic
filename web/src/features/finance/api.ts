import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'
import type { PaymentMethod } from '../payments/api'

export type Expense = Tables<'expenses'>
export type ExpenseCategory = 'rent' | 'salaries' | 'materials' | 'lab' | 'utilities' | 'maintenance' | 'marketing' | 'other'
export const CATEGORIES: ExpenseCategory[] = ['rent', 'salaries', 'materials', 'lab', 'utilities', 'maintenance', 'marketing', 'other']

export type Summary = {
  income: number
  income_by_method: Record<string, number>
  reversals: number
  expenses: number
  expenses_by_category: Record<string, number>
  net: number
  owed_now: number
  overdue_now: number
  stock_value: number
}

export async function getSummary(clinicId: string, from: string, to: string): Promise<Summary> {
  const { data, error } = await supabase.rpc('finance_summary', { p_clinic: clinicId, p_from: from, p_to: to })
  if (error) throw error
  return data as unknown as Summary
}

export type MonthPoint = { month: string; income: number; expenses: number; net: number }

/** Last `n` months (including the current one), for the trend chart. */
export async function getTrend(clinicId: string, n = 6): Promise<MonthPoint[]> {
  const now = new Date()
  const ranges = Array.from({ length: n }, (_, i) => {
    const offset = -(n - 1 - i)
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { month: iso(first), from: iso(first), to: iso(last) }
  })
  const results = await Promise.all(ranges.map((r) => getSummary(clinicId, r.from, r.to)))
  return results.map((s, i) => ({ month: ranges[i].month, income: s.income, expenses: s.expenses, net: s.net }))
}

export type DoctorEarning = { user_id: string; display_name: string; percent: number; base_amount: number; earned: number; basis: string }
export type SourceRow = { source: string; patients: number; collected: number }

export async function getDoctorEarnings(clinicId: string, from: string, to: string): Promise<DoctorEarning[]> {
  const { data, error } = await supabase.rpc('doctor_earnings', { p_clinic: clinicId, p_from: from, p_to: to })
  if (error) throw error
  return (data ?? []) as DoctorEarning[]
}

export async function getPatientSources(clinicId: string, from: string, to: string): Promise<SourceRow[]> {
  const { data, error } = await supabase.rpc('patient_sources', { p_clinic: clinicId, p_from: from, p_to: to })
  if (error) throw error
  return (data ?? []) as SourceRow[]
}

export async function getExpenses(clinicId: string, from: string, to: string): Promise<Expense[]> {
  const { data, error } = await supabase.from('expenses').select('*').eq('clinic_id', clinicId)
    .gte('spent_on', from).lte('spent_on', to)
    .order('spent_on', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function addExpense(clinicId: string, e: {
  spent_on: string; category: ExpenseCategory; amount: number; method: PaymentMethod; paid_to: string; note: string
}) {
  const { error } = await supabase.from('expenses').insert({
    clinic_id: clinicId, spent_on: e.spent_on, category: e.category, amount: e.amount, method: e.method,
    paid_to: e.paid_to.trim() || null, note: e.note.trim() || null,
  })
  if (error) throw error
}

export async function voidExpense(id: string, reason: string) {
  const { error } = await supabase.from('expenses').update({ voided_at: new Date().toISOString(), void_reason: reason.trim() }).eq('id', id)
  if (error) throw error
}
