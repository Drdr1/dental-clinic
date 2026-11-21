import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ar } from './ar'
import { en, type MessageKey } from './en'

export type Lang = 'ar' | 'en'
const dictionaries = { ar, en }

type I18n = {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  money: (value: number | null | undefined) => string
  date: (value: string | null | undefined) => string
  /** Minutes since midnight, "HH:MM[:SS]" or an ISO timestamp → a 12-hour clock. */
  time: (value: string | number | null | undefined) => string
}

const I18nContext = createContext<I18n | null>(null)

function readStoredLang(): Lang {
  try {
    return localStorage.getItem('lang') === 'en' ? 'en' : 'ar'
  } catch {
    return 'ar'
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang)

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem('lang', next)
    } catch {
      /* storage unavailable: keep in memory */
    }
  }, [])

  const value = useMemo<I18n>(() => {
    // Western digits in both languages: that's what patients and staff read on receipts.
    const locale = lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG'
    const moneyFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
    const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    const currency = lang === 'ar' ? 'ج.م' : 'EGP'
    return {
      lang,
      setLang,
      t: (key, vars) => {
        let text: string = dictionaries[lang][key] ?? en[key] ?? key
        if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v))
        return text
      },
      // Isolate the number (U+2066…U+2069) so a minus sign stays attached in right-to-left text.
      money: (v) => (v == null ? '—' : `\u2066${moneyFmt.format(v)}\u2069 ${currency}`),
      // Dates from Postgres `date` columns are plain YYYY-MM-DD; parse as local noon to avoid TZ shifts.
      date: (v) => (v ? dateFmt.format(new Date(v.length === 10 ? `${v}T12:00:00` : v)) : '—'),
      // The clinic reads the clock as 6:45 م, never 18:45. Stored values stay
      // 24-hour; this is only how they are shown.
      time: (v) => {
        if (v == null || v === '') return '—'
        let minutes: number
        if (typeof v === 'number') minutes = v
        else if (/^\d{1,2}:\d{2}/.test(v)) {
          const [h, m] = v.split(':').map(Number)
          minutes = h * 60 + m
        } else {
          const d = new Date(v)
          if (Number.isNaN(d.getTime())) return '—'
          minutes = d.getHours() * 60 + d.getMinutes()
        }
        const h24 = Math.floor(minutes / 60) % 24
        const h12 = h24 % 12 === 0 ? 12 : h24 % 12
        const mm = String(minutes % 60).padStart(2, '0')
        const suffix = lang === 'ar' ? (h24 < 12 ? 'ص' : 'م') : (h24 < 12 ? 'AM' : 'PM')
        // Isolated so the clock keeps its own direction inside Arabic text.
        return `\u2066${h12}:${mm}\u2069 ${suffix}`
      },
    }
  }, [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
