import type { MessageKey } from '../i18n/en'

/** Turn database errors from our RPCs into messages staff can act on. */
const known: Array<[RegExp, MessageKey]> = [
  [/exceeds outstanding/i, 'err.tooMuch'],
  [/only a doctor/i, 'err.doctorOnly'],
  [/already reversed/i, 'err.alreadyReversed'],
  [/cannot reverse a reversal/i, 'err.reverseReversal'],
  [/SESSION_LOCKED/i, 'err.sessionLocked'],
  [/Failed to fetch|NetworkError/i, 'err.offline'],
]

export function errorKey(error: unknown): MessageKey | null {
  const message = String((error as { message?: string })?.message ?? error ?? '')
  for (const [pattern, key] of known) if (pattern.test(message)) return key
  return null
}
