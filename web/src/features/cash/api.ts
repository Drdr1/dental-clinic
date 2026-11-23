import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'

export type Closing = Tables<'cash_closings'>

export type DayPayment = {
  id: string
  at: string
  receipt_no: number
  patient_id: string
  patient: string
  amount: number
  method: string
  note: string | null
  is_reversal: boolean
  taken_by: string
}

export type DayExpense = {
  id: string
  category: string
  amount: number
  paid_to: string | null
  note: string | null
}

export type DaySummary = {
  date: string
  opening_float: number
  cash_in: number
  cash_out: number
  expected_cash: number
  closing: Closing | null
  /** Every payment of the day, cash or not, in the order it was taken. */
  payments: DayPayment[]
  /** What was paid out of the drawer in cash. */
  cash_expenses: DayExpense[]
  income_by_method: Record<string, number>
}

export async function getDay(clinicId: string, date: string): Promise<DaySummary> {
  const { data, error } = await supabase.rpc('cash_day_summary', { p_clinic: clinicId, p_date: date })
  if (error) throw error
  return data as unknown as DaySummary
}

export async function closeDay(clinicId: string, date: string, counted: number, reason: string, note: string) {
  const { error } = await supabase.rpc('record_cash_closing', {
    p_clinic: clinicId, p_date: date, p_counted: counted,
    p_reason: reason.trim() || undefined, p_note: note.trim() || undefined,
  })
  if (error) throw error
}

/** Owner only: undo a day's closing so cash can be added to it again. The old count goes to the audit log. */
export async function reopenDay(clinicId: string, date: string, reason: string) {
  const { error } = await supabase.rpc('reopen_cash_day', { p_clinic: clinicId, p_date: date, p_reason: reason.trim() })
  if (error) throw error
}

export async function getClosings(clinicId: string): Promise<Closing[]> {
  const { data, error } = await supabase.from('cash_closings').select('*').eq('clinic_id', clinicId)
    .order('business_date', { ascending: false }).limit(60)
  if (error) throw error
  return data
}

export async function getClosers(clinicId: string) {
  const { data, error } = await supabase.from('clinic_members').select('user_id, display_name').eq('clinic_id', clinicId)
  if (error) throw error
  return new Map(data.map((m) => [m.user_id, m.display_name]))
}
