import { useEffect, useState, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { todayLocal } from '../../lib/dates'
import { getClinicCalendar, getDay, type DayAppointment } from './api'
import { AppointmentDialog } from './AppointmentDialog'
import { AppointmentDetails } from './AppointmentDetails'
import { minutesOfDay, minutesToTime, shiftDate, timeToMinutes } from './time'
import { apptStatusKey } from './labels'

const SLOT_PX = 26

type Open =
  | { kind: 'new'; time?: string; chairId?: string }
  | { kind: 'details'; appt: DayAppointment }
  | { kind: 'edit'; appt: DayAppointment }
  | null

export function AppointmentsPage() {
  const { clinicId } = useMember()
  const { t, lang } = useI18n()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? todayLocal()
  const setDate = (d: string) => setParams(d === todayLocal() ? {} : { date: d })
  const [open, setOpen] = useState<Open>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const calendar = useQuery({ queryKey: ['calendar', clinicId], queryFn: () => getClinicCalendar(clinicId) })
  const day = useQuery({ queryKey: ['day', clinicId, date], queryFn: () => getDay(clinicId, date), refetchInterval: 60_000 })

  const heading = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${date}T12:00:00`))

  const error = calendar.error ?? day.error
  const hours = calendar.data?.hours
  const chairs = calendar.data?.chairs ?? []
  const openMin = hours ? timeToMinutes(hours.opens_at) : 0
  const closeMin = hours ? timeToMinutes(hours.closes_at) : 0
  const slot = hours?.slot_minutes ?? 15
  const rows = Math.max(0, Math.ceil((closeMin - openMin) / slot))
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNow = date === todayLocal() && nowMin >= openMin && nowMin <= closeMin

  const block = (a: DayAppointment): CSSProperties => {
    const start = Math.max(minutesOfDay(a.starts_at), openMin)
    const end = Math.min(minutesOfDay(a.ends_at) || closeMin, closeMin)
    return {
      top: ((start - openMin) / slot) * SLOT_PX,
      height: Math.max(((end - start) / slot) * SLOT_PX - 3, SLOT_PX - 3),
    }
  }

  return (
    <section className="page calendar-page">
      <header className="page-head">
        <div>
          <h1>{t('appt.title')}</h1>
          <p className="muted">{heading}</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setDate(shiftDate(date, -1))}>{t('appt.prevDay')}</button>
          {date !== todayLocal() && <button className="btn" onClick={() => setDate(todayLocal())}>{t('appt.today')}</button>}
          <button className="btn" onClick={() => setDate(shiftDate(date, 1))}>{t('appt.nextDay')}</button>
          <input type="date" className="date-jump" value={date} aria-label={t('appt.date')}
            onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button className="btn btn-primary" onClick={() => setOpen({ kind: 'new' })}>{t('appt.new')}</button>
        </div>
      </header>

      {error && <ErrorNote error={error} onRetry={() => { calendar.refetch(); day.refetch() }} />}
      {(calendar.isPending || day.isPending) && <Skeleton rows={6} variant="list" />}

      {hours && day.data && (
        <>
          {day.data.length === 0 && <p className="muted">{t('appt.emptyDay')}</p>}
          <div className="cal" style={{ '--chairs': chairs.length } as CSSProperties}>
            <div className="cal-head">
              <span />
              {chairs.map((c) => <span key={c.id}>{c.name}</span>)}
            </div>
            <div className="cal-body" style={{ height: rows * SLOT_PX }}>
              <div className="cal-times">
                {Array.from({ length: rows }, (_, i) => openMin + i * slot).map((m) => (
                  <span key={m} style={{ height: SLOT_PX }} className={m % 60 === 0 ? 'is-hour' : ''}>
                    {m % 60 === 0 ? minutesToTime(m) : ''}
                  </span>
                ))}
              </div>
              {chairs.map((c) => (
                <div key={c.id} className="cal-col">
                  {Array.from({ length: rows }, (_, i) => openMin + i * slot).map((m) => (
                    <button key={m} type="button" className={`cal-slot ${m % 60 === 0 ? 'is-hour' : ''}`}
                      style={{ height: SLOT_PX }}
                      aria-label={t('appt.bookAt', { time: minutesToTime(m), chair: c.name })}
                      onClick={() => setOpen({ kind: 'new', time: minutesToTime(m), chairId: c.id })} />
                  ))}
                  {day.data.filter((a) => a.chair_id === c.id).map((a) => (
                    <button key={a.id} type="button" className={`cal-appt appt-${a.status}`} style={block(a)}
                      onClick={() => setOpen({ kind: 'details', appt: a })}>
                      <span className="cal-appt-line">
                        <span dir="ltr">{minutesToTime(minutesOfDay(a.starts_at))}</span>
                        <strong>{a.patientName}</strong>
                        {a.alerts && <span className="alert-dot" aria-label={t('patients.alert')} />}
                      </span>
                      <span className="cal-appt-sub">
                        {a.status !== 'booked' ? t(apptStatusKey(a.status)) : a.planTitle ?? a.notes ?? ''}
                      </span>
                    </button>
                  ))}
                  {showNow && <div className="cal-now" style={{ top: ((nowMin - openMin) / slot) * SLOT_PX }} />}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {open?.kind === 'new' && (
        <AppointmentDialog onClose={() => setOpen(null)} initial={{ date, time: open.time, chairId: open.chairId }} />
      )}
      {open?.kind === 'details' && (
        <AppointmentDetails appointment={open.appt} onClose={() => setOpen(null)}
          onEdit={() => setOpen({ kind: 'edit', appt: open.appt })} />
      )}
      {open?.kind === 'edit' && <AppointmentDialog appointment={open.appt} onClose={() => setOpen(null)} />}
    </section>
  )
}
