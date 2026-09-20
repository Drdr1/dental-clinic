import type { MessageKey } from '../i18n/en'

/** Turn database errors from our RPCs into messages staff can act on. */
const known: Array<[RegExp, MessageKey]> = [
  [/exceeds outstanding/i, 'err.tooMuch'],
  [/only a doctor/i, 'err.doctorOnly'],
  [/already reversed/i, 'err.alreadyReversed'],
  [/cannot reverse a reversal/i, 'err.reverseReversal'],
  [/SESSION_LOCKED/i, 'err.sessionLocked'],
  [/cannot move from/i, 'err.badTransition'],
  [/settle the active installment plan/i, 'err.activeInstallments'],
  [/Balance too small/i, 'err.balanceTooSmall'],
  [/below the amount already paid/i, 'err.belowPaid'],
  [/no longer open on this plan/i, 'err.itemsChanged'],
  [/appointments_no_overlap/i, 'err.overlap'],
  [/Treatment plan does not belong/i, 'err.planPatient'],
  [/LAST_OWNER/i, 'err.lastOwner'],
  [/SELF_CHANGE/i, 'err.selfChange'],
  [/^email_taken$/i, 'err.emailTaken'],
  [/^weak_password$/i, 'err.weakPassword'],
  [/^bad_email$/i, 'err.badEmail'],
  [/^not_owner$|Only the clinic owner/i, 'err.notOwner'],
  [/procedures_clinic_id_name_key|chairs_clinic_id_name_key/i, 'err.duplicateName'],
  [/Failed to send a request to the Edge Function|FunctionsFetchError/i, 'err.functionDown'],
  [/Failed to fetch|NetworkError/i, 'err.offline'],
]

export function errorKey(error: unknown): MessageKey | null {
  const message = String((error as { message?: string })?.message ?? error ?? '')
  for (const [pattern, key] of known) if (pattern.test(message)) return key
  return null
}
