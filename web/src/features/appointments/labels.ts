import type { MessageKey } from '../../i18n/en'

export const apptStatusKey = (s: string | null) => `appt.status.${s ?? 'booked'}` as MessageKey
