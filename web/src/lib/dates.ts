let clinicTimeZone: string | undefined

/** Set once the clinic is known: every "today" below is then the clinic's day. */
export function setClinicTimeZone(tz: string | null | undefined) {
  clinicTimeZone = tz || undefined
}

/** The calendar date (YYYY-MM-DD) of a moment, in the clinic's timezone (the browser's until it is known). */
export function clinicDate(d: Date): string {
  if (!clinicTimeZone) return toIsoDate(d)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: clinicTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  } catch {
    return toIsoDate(d)
  }
}

/** Today's date as YYYY-MM-DD in the clinic's timezone, not UTC. */
export function todayLocal(): string {
  return clinicDate(new Date())
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
