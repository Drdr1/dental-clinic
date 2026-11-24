import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase'
import type { PickedPatient } from '../../components/PatientPicker'
import { Modal } from '../../components/Modal'
import { todayLocal } from '../../lib/dates'
import { getClinicCalendar, getClinicDoctors, getDay, saveAppointment, type DayAppointment } from './api'
import { AppointmentDialog } from './AppointmentDialog'
import { AppointmentDetails } from './AppointmentDetails'
import { localToIso, minutesOfDay, minutesToTime, shiftDate, timeToMinutes } from './time'
import { apptStatusKey } from './labels'

/** Booked online and not yet confirmed by reception: the slot is held, but nobody has called the patient yet. */
const awaiting = (a: DayAppointment) => a.source === 'online' && !a.confirmed_at && a.status === 'booked'


type Open =
  | { kind: 'new'; time?: string; chairId?: string; patient?: PickedPatient; planId?: string }
  | { kind: 'details'; appt: DayAppointment }
  | { kind: 'edit'; appt: DayAppointment }
  | null

export function AppointmentsPage() {
  const member = useMember()
  const { clinicId } = member
  const { t, lang, time } = useI18n()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? todayLocal()
  const setDate = (d: string) => setParams(d === todayLocal() ? {} : { date: d })
  // ?new=1 from the top bar's "موعد جديد" opens the form straight away.
  useEffect(() => {
    if (!params.get('new')) return
    setOpen({ kind: 'new' })
    const next = new URLSearchParams(params); next.delete('new'); setParams(next, { replace: true })
  }, [params, setParams])
  const [open, setOpen] = useState<Open>(null)
  const [view, setView] = useState<'day' | 'list'>('day')
  const [now, setNow] = useState(() => new Date())
  // Dragging an appointment to another slot. The browser's own drag-and-drop
  // refuses to start on a <button> in some builds, so this is done with plain
  // pointer events: press, move, release. Nothing is saved on release — a slip
  // of the mouse must not silently move a patient's appointment.
  const [dragging, setDragging] = useState<DayAppointment | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  // Set while a real drag happens, so the mouse-up does not also open details.
  const dragged = useRef(false)
  const [move, setMove] = useState<{ appt: DayAppointment; chairId: string; startMin: number } | null>(null)
  const qc = useQueryClient()

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const calendar = useQuery({ queryKey: ['calendar', clinicId], queryFn: () => getClinicCalendar(clinicId) })
  // Doctors only ever see their own appointments; the owner picks.
  const isDoctorRole = member.role === 'doctor'
  const [filterDoctor, setFilterDoctor] = useState(params.get('doctor') ?? '')
  const doctorFilter = isDoctorRole ? member.userId : (filterDoctor || null)
  const doctors = useQuery({
    queryKey: ['clinic-doctors', clinicId], queryFn: () => getClinicDoctors(clinicId), enabled: !isDoctorRole,
  })
  const day = useQuery({
    queryKey: ['day', clinicId, date, doctorFilter],
    queryFn: () => getDay(clinicId, date, doctorFilter),
    refetchInterval: 60_000,
  })

  // Accepted plans with work left and nothing booked: the side list reception books from.
  const unscheduled = useQuery({
    queryKey: ['unscheduled', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('unscheduled_treatment').select('*').eq('clinic_id', clinicId).order('accepted_at').limit(8)
      if (error) throw error
      return data
    },
  })
  const doctorName = new Map((doctors.data ?? []).map((d) => [d.user_id, d.display_name]))

  const applyMove = useMutation({
    mutationFn: async () => {
      const m = move!
      const durationMs = Date.parse(m.appt.ends_at) - Date.parse(m.appt.starts_at)
      const startsAt = localToIso(date, minutesToTime(m.startMin))
      await saveAppointment({
        clinicId, patientId: m.appt.patient_id, chairId: m.chairId,
        doctorId: m.appt.doctor_id, planId: m.appt.treatment_plan_id,
        startsAt, endsAt: new Date(Date.parse(startsAt) + durationMs).toISOString(),
        notes: m.appt.notes ?? '',
      }, m.appt.id)
    },
    onSuccess: () => { setMove(null); qc.invalidateQueries({ queryKey: ['day'] }) },
  })

  /** Press, move, release. The slot under the cursor is found by hit-testing,
   *  which is why the appointment blocks stop taking pointer events mid-drag. */
  function startDrag(appt: DayAppointment, down: RPointerEvent<HTMLButtonElement>) {
    const el = down.currentTarget
    const fromX = down.clientX, fromY = down.clientY
    let started = false
    let target: { chairId: string; startMin: number } | null = null
    dragged.current = false

    const slotAt = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.cal-slot')
      if (!hit?.dataset.chair || !hit.dataset.min) return null
      return { chairId: hit.dataset.chair, startMin: Number(hit.dataset.min) }
    }

    const onMove = (e: PointerEvent) => {
      // A few pixels of slack: a click must not become a drag.
      if (!started && Math.hypot(e.clientX - fromX, e.clientY - fromY) < 5) return
      if (!started) { started = true; dragged.current = true; setDragging(appt) }
      target = slotAt(e.clientX, e.clientY)
      setHover(target ? `${target.chairId}:${target.startMin}` : null)
    }

    const onUp = () => {
      el.releasePointerCapture?.(down.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setDragging(null)
      setHover(null)
      if (started && target) {
        const unchanged = appt.chair_id === target.chairId && minutesOfDay(appt.starts_at) === target.startMin
        if (!unchanged) setMove({ appt, chairId: target.chairId, startMin: target.startMin })
      }
      // Let the click that follows the release pass through untouched.
      setTimeout(() => { dragged.current = false }, 0)
    }

    el.setPointerCapture?.(down.pointerId)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const heading = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${date}T12:00:00`))

  const error = calendar.error ?? day.error
  const hours = calendar.data?.hours
  const allChairs = calendar.data?.chairs ?? []
  // Columns: the working chairs, plus any switched-off chair that still has appointments this day.
  const chairs = allChairs.filter((c) => c.active || day.data?.some((a) => a.chair_id === c.id))
  const openMin = hours ? timeToMinutes(hours.opens_at) : 0
  const closeMin = hours ? timeToMinutes(hours.closes_at) : 0
  const slot = hours?.slot_minutes ?? 15
  // About 112px an hour whatever the slot length, so a 30-minute visit has room for two lines.
  const SLOT_PX = Math.max(22, Math.round((112 * slot) / 60))
  const rows = Math.max(0, Math.ceil((closeMin - openMin) / slot))
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const onToday = date === todayLocal()
  const showNow = onToday && nowMin >= openMin && nowMin <= closeMin

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
        <div className="title-line">
          <h1>{t('appt.title')}</h1>
          <span className="muted">{heading}{day.data ? ` · ${t('appt.count', { n: day.data.length })}` : ''}</span>
        </div>
        <button className="btn btn-primary" onClick={() => setOpen({ kind: 'new' })}>{t('appt.new')}</button>
      </header>

      <div className="toolbar cal-toolbar">
        <div className="day-nav">
          <button className="btn icon-square" aria-label={t('appt.prevDay')} title={t('appt.prevDay')}
            onClick={() => setDate(shiftDate(date, -1))}><span aria-hidden="true">›</span></button>
          <button className={`btn${onToday ? ' btn-soft' : ''}`} onClick={() => setDate(todayLocal())}>{t('appt.today')}</button>
          <button className="btn icon-square" aria-label={t('appt.nextDay')} title={t('appt.nextDay')}
            onClick={() => setDate(shiftDate(date, 1))}><span aria-hidden="true">‹</span></button>
          <input type="date" className="date-jump" value={date} aria-label={t('appt.date')}
            onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={view === 'day'} className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>{t('appt.viewDay')}</button>
          <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>{t('appt.viewList')}</button>
        </div>
        {!isDoctorRole && (doctors.data?.length ?? 0) > 1 && (
          <label className="inline-field">
            <span className="muted">{t('doc.doctor')}</span>
            <select className="date-jump" value={filterDoctor}
              onChange={(e) => setFilterDoctor(e.target.value)}>
              <option value="">{t('appt.allDoctors')}</option>
              {doctors.data!.map((d) => <option key={d.user_id} value={d.user_id}>{d.display_name}</option>)}
            </select>
          </label>
        )}
        <ul className="legend" aria-hidden="true">
          {(['booked', 'arrived', 'in_session', 'done', 'no_show'] as const).map((st) => (
            <li key={st}><i className={`sw appt-${st}`} />{t(apptStatusKey(st))}</li>
          ))}
        </ul>
      </div>

      {error && <ErrorNote error={error} onRetry={() => { calendar.refetch(); day.refetch() }} />}
      {(calendar.isPending || day.isPending) && <Skeleton rows={6} variant="list" />}

      {hours && day.data && (
        <div className="cal-layout">
        <div className="cal-main">
          {day.data.length === 0 && <p className="muted">{t('appt.emptyDay')}</p>}
          {view === 'list' ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>{t('appt.col.time')}</th><th>{t('patients.col.name')}</th><th>{t('appt.col.plan')}</th>
                  <th>{t('doc.doctor')}</th><th>{t('appt.col.chair')}</th><th>{t('inst.col.status')}</th>
                </tr></thead>
                <tbody>
                  {day.data.map((a) => (
                    <tr key={a.id} className="click-row" onClick={() => setOpen({ kind: 'details', appt: a })}>
                      <td className="strong nowrap">{time(a.starts_at)}</td>
                      <td>{a.patientName}{a.alerts && <span className="alert-dot" aria-label={t('patients.alert')} />}</td>
                      <td className="muted">{a.planTitle ?? a.notes ?? ''}</td>
                      <td className="muted">{(a.doctor_id && doctorName.get(a.doctor_id)) || ''}</td>
                      <td className="muted">{chairs.find((c) => c.id === a.chair_id)?.name ?? ''}</td>
                      <td>{awaiting(a)
                        ? <span className="badge appt-badge appt-awaiting">{t('book.awaiting')}</span>
                        : <span className={`badge appt-badge appt-${a.status}`}>{t(apptStatusKey(a.status))}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
          <div className="cal" style={{ '--chairs': chairs.length } as CSSProperties}>
            <div className="cal-head">
              <span />
              {chairs.map((c) => {
                const docs = [...new Set(day.data!.filter((a) => a.chair_id === c.id && a.doctor_id).map((a) => doctorName.get(a.doctor_id!)).filter(Boolean))]
                return <span key={c.id}><b>{c.name}</b>{!c.active && <small> · {t('appt.chairOff')}</small>}{docs.length > 0 && <small> · {docs.join('، ')}</small>}</span>
              })}
            </div>
            <div className={`cal-body ${dragging ? 'is-dragging' : ''}`} style={{ height: rows * SLOT_PX }}>
              <div className="cal-times">
                {Array.from({ length: rows }, (_, i) => openMin + i * slot).map((m) => (
                  <span key={m} style={{ height: SLOT_PX }} className={m % 60 === 0 ? 'is-hour' : ''}>
                    {m % 60 === 0 ? time(m) : ''}
                  </span>
                ))}
              </div>
              {chairs.map((c) => (
                <div key={c.id} className="cal-col">
                  {Array.from({ length: rows }, (_, i) => openMin + i * slot).map((m) => (
                    <button key={m} type="button"
                      className={`cal-slot ${m % 60 === 0 ? 'is-hour' : ''} ${hover === `${c.id}:${m}` ? 'is-drop' : ''}`}
                      style={{ height: SLOT_PX }}
                      data-chair={c.id} data-min={m}
                      aria-label={t('appt.bookAt', { time: time(m), chair: c.name })}
                      onClick={() => setOpen({ kind: 'new', time: minutesToTime(m), chairId: c.id })} />
                  ))}
                  {day.data.filter((a) => a.chair_id === c.id).map((a) => (
                    <button key={a.id} type="button"
                      className={`cal-appt appt-${a.status} ${awaiting(a) ? 'is-awaiting' : ''} ${a.status === 'booked' ? 'is-movable' : ''} ${dragging?.id === a.id ? 'is-dragging' : ''}`}
                      style={block(a)}
                      onPointerDown={(e: RPointerEvent<HTMLButtonElement>) => {
                        // Only a live booking can be moved, and only with a mouse:
                        // on a touch screen a press has to stay a tap and a scroll.
                        if (a.status !== 'booked' || e.pointerType === 'touch' || e.button !== 0) return
                        startDrag(a, e)
                      }}
                      onClick={() => { if (!dragged.current) setOpen({ kind: 'details', appt: a }) }}>
                      <span className="cal-appt-line">
                        <strong>{a.patientName}</strong>
                        {a.alerts && <span className="alert-dot" aria-label={t('patients.alert')} />}
                      </span>
                      <span className="cal-appt-sub">
                        {[awaiting(a) ? t('book.awaiting') : null, a.planTitle ?? a.notes, time(a.starts_at), a.status !== 'booked' ? t(apptStatusKey(a.status)) : null].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  ))}
                  {showNow && <div className="cal-now" style={{ top: ((nowMin - openMin) / slot) * SLOT_PX }} />}
                </div>
              ))}
            </div>
          </div>
          )}
          {view === 'day' && <p className="muted small drag-hint">{t('appt.dragHint')}</p>}
        </div>
        <aside className="cal-aside">
          <NowCard appts={day.data} doctorName={doctorName} chairs={chairs} onOpen={(a) => setOpen({ kind: 'details', appt: a })} />
          {(unscheduled.data?.length ?? 0) > 0 && (
            <section className="panel">
              <h2>{t('appt.needsBooking')}</h2>
              <ul className="work-list">
                {unscheduled.data!.map((u) => (
                  <li key={u.treatment_plan_id}>
                    <div>
                      <Link to={`/patients/${u.patient_id}`} className="row-link">{u.full_name}</Link>
                      <p className="muted">{u.title}{u.remaining_items ? ` · ${t('appt.itemsLeft', { n: u.remaining_items })}` : ''}</p>
                    </div>
                    <button className="btn btn-small" onClick={() => setOpen({
                      kind: 'new',
                      patient: { id: u.patient_id ?? '', full_name: u.full_name ?? '', phone: u.phone ?? '', medical_alerts: null },
                      planId: u.treatment_plan_id ?? undefined,
                    })}>{t('appt.book')}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
        </div>
      )}

      {move && (
        <Modal title={t('appt.moveTitle')} onClose={() => setMove(null)}>
          <>
            <p>{t('appt.moveFrom', {
              patient: move.appt.patientName,
              from: time(move.appt.starts_at),
              chairFrom: chairs.find((c) => c.id === move.appt.chair_id)?.name ?? '',
            })}</p>
            <p><strong>{t('appt.moveTo', {
              to: time(move.startMin),
              chairTo: chairs.find((c) => c.id === move.chairId)?.name ?? '',
            })}</strong></p>
            {applyMove.isError && <ErrorNote error={applyMove.error} />}
            <div className="dialog-actions">
              <button className="btn btn-primary" disabled={applyMove.isPending}
                onClick={() => applyMove.mutate()}>
                {applyMove.isPending ? t('common.saving') : t('appt.moveConfirm')}
              </button>
              <button className="btn" onClick={() => setMove(null)}>{t('common.cancel')}</button>
            </div>
          </>
        </Modal>
      )}

      {open?.kind === 'new' && (
        <AppointmentDialog onClose={() => setOpen(null)} initial={{ date, time: open.time, chairId: open.chairId, patient: open.patient, planId: open.planId }} />
      )}
      {open?.kind === 'details' && (
        <AppointmentDetails appointment={open.appt} onClose={() => setOpen(null)}
          onEdit={() => setOpen({ kind: 'edit', appt: open.appt })} />
      )}
      {open?.kind === 'edit' && <AppointmentDialog appointment={open.appt} onClose={() => setOpen(null)} />}
    </section>
  )
}

/** The appointment in the chair now, or the one who just walked in, with its next step. */
function NowCard({ appts, doctorName, chairs, onOpen }: {
  appts: DayAppointment[]; doctorName: Map<string, string>; chairs: { id: string; name: string }[]
  onOpen: (a: DayAppointment) => void
}) {
  const { t, time } = useI18n()
  const a = appts.find((x) => x.status === 'in_session') ?? appts.find((x) => x.status === 'arrived')
  if (!a) return null
  const who = [a.doctor_id && doctorName.get(a.doctor_id), chairs.find((c) => c.id === a.chair_id)?.name].filter(Boolean).join(' · ')
  return (
    <section className="panel now-card">
      <div className="panel-head">
        <h2>{a.patientName}</h2>
        <span className={`badge appt-badge appt-${a.status}`}>{t(apptStatusKey(a.status))}</span>
      </div>
      {a.alerts && <p className="alert-strip">{a.alerts}</p>}
      <dl className="facts">
        <div><dt>{t('appt.col.plan')}</dt><dd>{a.planTitle ?? '—'}</dd></div>
        <div><dt>{t('appt.col.time')}</dt><dd>{time(a.starts_at)} – {time(a.ends_at)}</dd></div>
        {who && <div><dt>{t('doc.doctor')}</dt><dd>{who}</dd></div>}
      </dl>
      <div className="two-btns">
        <Link to={`/patients/${a.patient_id}`} className="btn">{t('appt.openFile')}</Link>
        <button className="btn btn-ink" onClick={() => onOpen(a)}>{t('appt.nextStep')}</button>
      </div>
    </section>
  )
}
