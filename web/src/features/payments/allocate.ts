import type { InstallmentRow } from './api'

export type AllocationLine = { seq: number; isDownPayment: boolean; take: number; remaining: number }

/** Mirrors record_payment(): oldest open installment first. Used only to preview, the database decides. */
export function previewAllocation(rows: InstallmentRow[], amount: number): { lines: AllocationLine[]; leftover: number } {
  let left = Math.round(amount * 100) / 100
  const lines: AllocationLine[] = []
  const open = rows
    .filter((r) => r.status !== 'cancelled' && (r.remaining ?? 0) > 0)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  for (const r of open) {
    if (left <= 0) break
    const remaining = r.remaining ?? 0
    const take = Math.min(left, remaining)
    lines.push({ seq: r.seq ?? 0, isDownPayment: !!r.is_down_payment, take, remaining })
    left = Math.round((left - take) * 100) / 100
  }
  return { lines, leftover: left }
}

export function suggestedAmount(rows: InstallmentRow[]): number {
  const open = rows.filter((r) => r.status !== 'cancelled' && (r.remaining ?? 0) > 0)
  const overdue = open.filter((r) => r.status === 'overdue' || r.status === 'in_grace' || r.status === 'due')
  if (overdue.length) return overdue.reduce((sum, r) => sum + (r.remaining ?? 0), 0)
  const next = [...open].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))[0]
  return next?.remaining ?? 0
}
