import { toIsoDate, todayLocal } from '../../lib/dates'

/** Calendar month, `offset` months back. The current month stops at today. */
export function monthRange(offset: number) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { from: toIsoDate(first), to: offset === 0 ? todayLocal() : toIsoDate(last) }
}
