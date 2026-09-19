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
      money: (v) => (v == null ? '—' : `${moneyFmt.format(v)} ${currency}`),
      // Dates from Postgres `date` columns are plain YYYY-MM-DD; parse as local noon to avoid TZ shifts.
      date: (v) => (v ? dateFmt.format(new Date(v.length === 10 ? `${v}T12:00:00` : v)) : '—'),
    }
  }, [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
