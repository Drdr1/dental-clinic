import { addMonthsClamped } from '../../lib/dates'

export type ScheduleLine = { seq: number; dueDate: string; amount: number }

/** Mirrors _generate_installments(): whole-pound installments, the last one absorbs the rounding. */
export function previewSchedule(balance: number, months: number, firstDue: string): ScheduleLine[] {
  if (balance <= 0 || months < 1 || !firstDue) return []
  const base = Math.trunc(balance / months)
  if (base <= 0) return []
  return Array.from({ length: months }, (_, k) => ({
    seq: k + 1,
    dueDate: addMonthsClamped(firstDue, k),
    amount: k === months - 1 ? Math.round((balance - base * (months - 1)) * 100) / 100 : base,
  }))
}
