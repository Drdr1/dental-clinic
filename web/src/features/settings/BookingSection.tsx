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
}

async function getBooking(clinicId: string): Promise<Booking> {
  const { data, error } = await supabase.from('clinics')
    .select('booking_enabled, booking_slug, booking_daily_limit, booking_min_notice_hours, booking_horizon_days')
    .eq('id', clinicId).single()
  if (error) throw error
  return data
}

export function BookingSection() {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['booking-settings', clinicId], queryFn: () => getBooking(clinicId) })
  const [s, setS] = useState<Booking | null>(null)
  useEffect(() => { if (q.data) setS(q.data) }, [q.data])

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('clinics').update({
        ...s, booking_slug: s!.booking_slug?.trim().toLowerCase() || null,
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
