/** Today's date as YYYY-MM-DD in the browser's timezone (the clinic's), not UTC. */
export function todayLocal(): string {
  return toIsoDate(new Date())
}

export function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** first + k months, clamped to the month's last day — the same rule as the database. */
export function addMonthsClamped(isoDate: string, k: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const lastDay = new Date(y, m - 1 + k + 1, 0).getDate()
  return toIsoDate(new Date(y, m - 1 + k, Math.min(d, lastDay)))
}
