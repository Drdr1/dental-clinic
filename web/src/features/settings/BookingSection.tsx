import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'

type Booking = {
  booking_enabled: boolean
  booking_slug: string | null
  booking_daily_limit: number
  booking_min_notice_hours: number
  booking_horizon_days: number
  address: string | null
  closed_weekdays: number[]
  booking_show_prices: boolean
}

async function getBooking(clinicId: string): Promise<Booking> {
  const { data, error } = await supabase.from('clinics')
    .select('booking_enabled, booking_slug, booking_daily_limit, booking_min_notice_hours, booking_horizon_days, address, closed_weekdays, booking_show_prices')
    .eq('id', clinicId).single()
  if (error) throw error
  return data
}

export function BookingSection() {
  const { clinicId } = useMember()
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['booking-settings', clinicId], queryFn: () => getBooking(clinicId) })
  const [s, setS] = useState<Booking | null>(null)
  useEffect(() => { if (q.data) setS(q.data) }, [q.data])

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('clinics').update({
        ...s, booking_slug: s!.booking_slug?.trim().toLowerCase() || null, address: s!.address?.trim() || null,
      }).eq('id', clinicId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['booking-settings'] }),
  })

  if (!s) return null
  const set = <K extends keyof Booking>(k: K, v: Booking[K]) => setS({ ...s, [k]: v })
  const link = s.booking_slug ? `${window.location.origin}/book/${s.booking_slug}` : ''

  return (
    <section className="panel">
      <h2>{t('book.settingsTitle')}</h2>
      <p className="muted">{t('book.settingsHint')}</p>

      <label className="check">
        <input type="checkbox" checked={s.booking_enabled} onChange={(e) => set('booking_enabled', e.target.checked)} />
        <span>{t('book.enable')}</span>
      </label>

      <label className="field">
        <span>{t('book.slug')}</span>
        <input dir="ltr" value={s.booking_slug ?? ''} placeholder="darder"
          onChange={(e) => set('booking_slug', e.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())} />
        {link && <small className="hint" dir="ltr">{link}</small>}
      </label>

      <div className="field-row">
        <label className="field">
          <span>{t('book.dailyLimit')}</span>
          <input type="number" min={0} max={100} dir="ltr" value={s.booking_daily_limit}
            onChange={(e) => set('booking_daily_limit', Number(e.target.value))} />
          <small className="hint">{t('book.dailyLimitHint')}</small>
        </label>
        <label className="field">
          <span>{t('book.minNotice')}</span>
          <input type="number" min={0} max={168} dir="ltr" value={s.booking_min_notice_hours}
            onChange={(e) => set('booking_min_notice_hours', Number(e.target.value))} />
        </label>
        <label className="field">
          <span>{t('book.horizon')}</span>
          <input type="number" min={1} max={180} dir="ltr" value={s.booking_horizon_days}
            onChange={(e) => set('booking_horizon_days', Number(e.target.value))} />
        </label>
      </div>

      <label className="field">
        <span>{t('book.address')}</span>
        <input value={s.address ?? ''} maxLength={200} onChange={(e) => set('address', e.target.value)} />
      </label>

      <div className="field">
        <span>{t('book.closedDays')}</span>
        <div className="chips">
          {[6, 0, 1, 2, 3, 4, 5].map((d) => {
            const on = s.closed_weekdays.includes(d)
            return (
              <button key={d} type="button" className={`chip chip-lg${on ? ' on' : ''}`} aria-pressed={on}
                onClick={() => set('closed_weekdays', on ? s.closed_weekdays.filter((x) => x !== d) : [...s.closed_weekdays, d].sort())}>
                {new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-EG', { weekday: 'long' }).format(new Date(2026, 0, 4 + d, 12))}
              </button>
            )
          })}
        </div>
      </div>

      <label className="check">
        <input type="checkbox" checked={s.booking_show_prices} onChange={(e) => set('booking_show_prices', e.target.checked)} />
        <span>{t('book.showPrices')}</span>
      </label>

      {save.isError && <ErrorNote error={save.error} />}
      <div className="dialog-actions">
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        {link && s.booking_enabled && (
          <a className="btn" href={link} target="_blank" rel="noreferrer">{t('book.openPage')}</a>
        )}
      </div>
      <p className="hint">{t('book.servicesHint')}</p>
    </section>
  )
}
