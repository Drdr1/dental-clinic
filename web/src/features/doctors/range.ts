import { toIsoDate, todayLocal } from '../../lib/dates'

/** Calendar month, `offset` months back. The current month stops at today. */
export function monthRange(offset: number) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { from: toIsoDate(first), to: offset === 0 ? todayLocal() : toIsoDate(last) }
}

/** "2026-10" → that whole calendar month; the current month stops at today. */
export function monthFromKey(key: string) {
  const [y, m] = key.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const last = new Date(y, m, 0)
  const now = new Date()
  const isCurrent = y === now.getFullYear() && m === now.getMonth() + 1
  return { from: toIsoDate(first), to: isCurrent ? todayLocal() : toIsoDate(last) }
}

/** The "YYYY-MM" an ISO date belongs to, for the month input. */
export function monthKeyOf(iso: string) {
  return iso.slice(0, 7)
}
