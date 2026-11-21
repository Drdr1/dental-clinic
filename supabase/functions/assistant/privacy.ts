/**
 * Keeping patient identities on this server.
 *
 * The clinic agreed that patient data may go to a model API only where it
 * cannot be de-identified first. In practice that means one thing leaves:
 * the words the receptionist types, because looking a patient up requires
 * saying their name. Everything the database hands back is stripped before
 * it goes out and put back before anyone reads the answer.
 *
 * So the model reasons about "PATIENT_1 owes 2,035 since 5 November" and
 * the receptionist reads "نجوى احمد فهيم عليها 2,035 من 5 نوفمبر".
 */

/** Fields whose values identify a person rather than describe a case. */
const IDENTIFYING = new Set([
  'full_name', 'patient', 'patient_name', 'signed_by_name', 'paid_to',
  'phone', 'whatsapp_phone', 'national_id', 'address',
  'display_name', 'taken_by', 'doctor_name', 'closed_by', 'registration_no',
])

/** Values too short or too generic to be worth a token of their own. */
function worthHiding(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 1
}

export class Pseudonyms {
  /** real value → token, so the same patient keeps one token per question. */
  private readonly forward = new Map<string, string>()
  /** token → real value, for putting the answer back together. */
  private readonly back = new Map<string, string>()
  private counters = new Map<string, number>()

  private tokenFor(kind: string, value: string): string {
    const existing = this.forward.get(value)
    if (existing) return existing
    const n = (this.counters.get(kind) ?? 0) + 1
    this.counters.set(kind, n)
    const token = `${kind}_${n}`
    this.forward.set(value, token)
    this.back.set(token, value)
    return token
  }

  /** The kind of token, so the model can tell a person from a phone number. */
  private kindOf(field: string): string {
    if (field === 'phone' || field === 'whatsapp_phone') return 'PHONE'
    if (field === 'national_id' || field === 'registration_no') return 'NATIONAL_ID'
    if (field === 'address') return 'ADDRESS'
    if (field === 'display_name' || field === 'taken_by' || field === 'doctor_name'
      || field === 'closed_by') return 'STAFF'
    return 'PATIENT'
  }

  /**
   * Known identities, longest first. A query the model writes itself can
   * name its columns anything — "select full_name as n" — so hiding by
   * column name alone is not enough. Once these are loaded, any string in a
   * result that contains a known name or number has it replaced, whatever
   * the column is called and wherever in a sentence it sits (a note that
   * says "اتصلت بنجوى احمد فهيم" loses the name too).
   */
  private known: { value: string; kind: string }[] = []

  learn(entries: { value: unknown; kind: string }[]): void {
    const seen = new Set(this.known.map((k) => k.value))
    for (const { value, kind } of entries) {
      if (typeof value !== 'string') continue
      const v = value.trim()
      // Too short to be safe to replace inside ordinary words.
      const minLen = kind === 'PHONE' || kind === 'NATIONAL_ID' ? 6 : 4
      if (v.length < minLen || seen.has(v)) continue
      seen.add(v)
      this.known.push({ value: v, kind })
    }
    this.known.sort((a, b) => b.value.length - a.value.length)
  }

  get learned(): boolean {
    return this.known.length > 0
  }

  private scrub(text: string): string {
    if (!this.known.length || /^(PATIENT|PHONE|STAFF|NATIONAL_ID|ADDRESS)_\d+$/.test(text)) return text
    let out = text
    for (const { value, kind } of this.known) {
      if (out.includes(value)) out = out.split(value).join(this.tokenFor(kind, value))
    }
    return out
  }

  /** Replace identifying values anywhere in a tool result, at any depth. */
  hide<T>(value: T, field?: string): T {
    if (Array.isArray(value)) {
      return value.map((v) => this.hide(v, field)) as unknown as T
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.hide(v, k)
      }
      return out as unknown as T
    }
    if (field && IDENTIFYING.has(field) && worthHiding(value)) {
      return this.tokenFor(this.kindOf(field), value) as unknown as T
    }
    if (typeof value === 'string') return this.scrub(value) as unknown as T
    return value
  }

  /**
   * Carry the tokens of earlier turns into this one, so "PATIENT_1" in the
   * conversation so far still means the same person. The browser holds this
   * map between turns; it only ever travels between the browser and here.
   */
  seed(map: Record<string, string>): void {
    for (const [token, value] of Object.entries(map)) {
      const m = /^(PATIENT|PHONE|STAFF|NATIONAL_ID|ADDRESS)_(\d+)$/.exec(token)
      if (!m || typeof value !== 'string' || !value || value.length > 300) continue
      if (this.forward.has(value) || this.back.has(token)) continue
      this.forward.set(value, token)
      this.back.set(token, value)
      const n = Number(m[2])
      if (n > (this.counters.get(m[1]) ?? 0)) this.counters.set(m[1], n)
    }
  }

  /** Every token so far and what it stands for, for the next turn. */
  toMap(): Record<string, string> {
    return Object.fromEntries(this.back)
  }

  /** Put the real values back into the answer the person will read. */
  reveal(text: string): string {
    if (!this.back.size) return text
    // Longest tokens first so PATIENT_10 is not eaten by PATIENT_1.
    const tokens = [...this.back.keys()].sort((a, b) => b.length - a.length)
    let out = text
    for (const token of tokens) {
      out = out.split(token).join(this.back.get(token)!)
    }
    return out
  }

  /** What actually left the server, for the answer's footer. */
  get hiddenCount(): number {
    return this.back.size
  }
}
