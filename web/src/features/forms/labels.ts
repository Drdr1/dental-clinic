import type { Lang } from '../../i18n'
import { OPTION_LABELS, type Question } from './api'

export const qLabel = (q: Question, lang: Lang) => (lang === 'ar' ? q.label_ar ?? q.label_en : q.label_en ?? q.label_ar) ?? q.id

export function optionValue(o: string | { value: string }) {
  return typeof o === 'string' ? o : o.value
}

export function optionLabel(o: string | { value: string; label_ar?: string; label_en?: string }, lang: Lang) {
  if (typeof o !== 'string') return (lang === 'ar' ? o.label_ar ?? o.label_en : o.label_en ?? o.label_ar) ?? o.value
  return OPTION_LABELS[o]?.[lang] ?? o
}
