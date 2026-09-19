/** Keep digits and a leading +, drop spaces and dashes. */
export function normalizePhone(input: string): string {
  const trimmed = input.trim()
  const digits = trimmed.replace(/\D/g, '')
  return trimmed.startsWith('+') ? `+${digits}` : digits
}

export function isValidPhone(phone: string): boolean {
  return /^\+?\d{8,15}$/.test(phone)
}

/** wa.me needs the international form without "+". Egyptian local numbers (01…) get the 20 prefix. */
export function whatsappLink(phone: string): string {
  const p = normalizePhone(phone).replace(/^\+/, '')
  const intl = /^0\d{10}$/.test(p) ? `20${p.slice(1)}` : p
  return `https://wa.me/${intl}`
}

export function ageFrom(dob: string | null): number | null {
  if (!dob) return null
  const birth = new Date(`${dob}T12:00:00`)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const beforeBirthday =
    now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age
}
