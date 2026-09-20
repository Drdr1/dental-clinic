import { toIsoDate } from '../../lib/dates'

/** "12:00:00" → minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(min: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
}

/** Local date + "HH:MM" → ISO timestamp (the browser runs in the clinic's timezone). */
export function localToIso(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  return new Date(y, mo - 1, d, h, mi).toISOString()
}

export function minutesOfDay(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

export function localDateOf(iso: string): string {
  return toIsoDate(new Date(iso))
}

export function dayRange(date: string): { from: string; to: string } {
  const [y, m, d] = date.split('-').map(Number)
  return { from: new Date(y, m - 1, d).toISOString(), to: new Date(y, m - 1, d + 1).toISOString() }
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return toIsoDate(new Date(y, m - 1, d + days))
}
