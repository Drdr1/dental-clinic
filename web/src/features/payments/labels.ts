import type { MessageKey } from '../../i18n/en'

export const methodKey = (m: string) => `method.${m}` as MessageKey
export const installmentStatusKey = (s: string | null) => `inst.${s ?? 'upcoming'}` as MessageKey

export const installmentTone: Record<string, string> = {
  paid: 'ok',
  overdue: 'danger',
  in_grace: 'warn',
  due: 'warn',
  upcoming: 'neutral',
  cancelled: 'muted',
}
