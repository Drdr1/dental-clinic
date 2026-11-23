import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { PendingBookings } from '../booking/PendingBookings'
import { templates, waMessage } from '../../lib/whatsapp'
import { getToday, type TodayData } from './api'
import { setAppointmentStatus } from '../appointments/api'
import { apptStatusKey } from '../appointments/labels'

const agendaOrder = ['overdue', 'in_grace', 'due', 'upcoming']

// How far along a lab case is, out of three: at the lab, tried in, delivered.
const labProgress: Record<string, number> = {
  at_lab: 1, awaiting_tryin: 1, tryin_ready: 2, awaiting_delivery: 2, delivered: 3, received: 3, fitted: 3,
}

/** Rows of the day list shown before "show all". */
const DAY_ROWS = 8
/** Installments shown before "show the rest". */
const INST_ROWS = 4

export function TodayPage() {
  const { clinicId, clinicName, role, displayName } = useMember()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['today', clinicId], queryFn: () => getToday(clinicId), refetchInterval: 5 * 60_000 })
  // Reception seats the waiting patient straight from the chairs board.
  const seat = useMutation({
    mutationFn: (id: string) => setAppointmentStatus(id, 'in_session'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today'] })
      qc.invalidateQueries({ queryKey: ['day'] })
    },
  })

  if (q.isPending) return <section className="page"><Skeleton variant="cards" rows={4} /><Skeleton rows={4} /></section>
  if (q.isError) return <section className="page"><ErrorNote error={q.error} onRetry={() => q.refetch()} /></section>

  return (
    <>
      {seat.isError && <section className="page"><ErrorNote error={seat.error} /></section>}
      <TodayView data={q.data} clinicName={clinicName} displayName={displayName}
        // Clinic-wide money belongs to whoever handles it: the owner and reception.
        // Doctors still see each patient's own balance, which the session lock depends on.
        seesMoney={role !== 'doctor'} bookings={<PendingBookings />}
        onSeat={(id) => seat.mutate(id)} seating={seat.isPending ? seat.variables : null} />
    </>
  )
}

type ViewProps = {
  data: TodayData
  clinicName: string
  displayName: string
  seesMoney: boolean
  /** Online bookings waiting for a call; it fetches for itself, so the page takes it ready-made. */
  bookings?: ReactNode
  /** Move a waiting patient into the chair. */
  onSeat?: (appointmentId: string) => void
  /** The appointment being seated right now, if any. */
  seating?: string | null
  /** The moment the page describes. Only a preview ever sets it. */
  now?: Date
}

export function TodayView({ data, clinicName, displayName, seesMoney, bookings, onSeat, seating, now = new Date() }: ViewProps) {
  const { t, money, date, time, lang } = useI18n()
  const { agenda, recall, labs, unscheduled, appointments, lowStock, collectedToday, week, weekAgo, paidToday, owed, chairs, doctorNames } = data
  const [doctorFilter, setDoctorFilter] = useState('')
  const [allRows, setAllRows] = useState(false)
  const [allInst, setAllInst] = useState(false)

  const locale = lang === 'en' ? 'en-EG' : 'ar-EG-u-nu-latn'
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' })
  const longDate = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })
  const shortDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })
  const dayOnly = (v: string) => new Date(v.length === 10 ? `${v}T12:00:00` : v)

  const sortedAgenda = [...agenda].sort(
    (a, b) => agendaOrder.indexOf(a.status ?? '') - agendaOrder.indexOf(b.status ?? '') ||
      (a.due_date ?? '').localeCompare(b.due_date ?? ''),
  )
  const overdue = agenda.filter((a) => a.status === 'overdue')
  const overdueAmount = overdue.reduce((sum, a) => sum + (a.remaining ?? 0), 0)
  const overduePatients = new Set(overdue.map((a) => a.patient_id)).size
  const oldest = Math.max(0, ...overdue.map((a) => a.days_overdue ?? 0))
  // How old the late money is: over a month, over a week, this week.
  const aging = [
    overdue.filter((a) => (a.days_overdue ?? 0) > 30),
    overdue.filter((a) => (a.days_overdue ?? 0) > 7 && (a.days_overdue ?? 0) <= 30),
    overdue.filter((a) => (a.days_overdue ?? 0) <= 7),
  ].map((group) => group.reduce((sum, a) => sum + (a.remaining ?? 0), 0))
  const nothing = !agenda.length && !recall.length && !labs.length && !unscheduled.length && !appointments.length && !lowStock.length

  const done = appointments.filter((a) => a.status === 'done').length
  const here = appointments.filter((a) => a.status === 'arrived' || a.status === 'in_session').length
  const coming = appointments.filter((a) => a.status === 'booked').length
  const chairName = new Map(chairs.map((c) => [c.id, c.name]))
  const weekMax = Math.max(1, ...week.map((d) => d.amount))
  const thousands = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const vsWeekAgo = collectedToday - weekAgo
  // The week as a line, oldest first; mirrored in Arabic so today sits where the bars put it.
  const spark = week.map((d, i) => `${(i / 6) * 100},${28 - (d.amount / weekMax) * 26}`).join(' ')

  // What each chair is doing this minute: someone in it, someone waiting for it, or free until the next booking.
  const board = chairs.map((chair) => {
    const mine = appointments.filter((a) => a.chair_id === chair.id)
    const sitting = mine.find((a) => a.status === 'in_session')
    const waiting = mine.find((a) => a.status === 'arrived')
    const next = mine.find((a) => a.status === 'booked' && new Date(a.ends_at) > now)
    return { chair, sitting, waiting, next }
  })

  // The day list: everyone, or one doctor's patients.
  const doctorsToday = [...new Set(appointments.map((a) => a.doctor_id).filter((id): id is string => !!id))]
  const listed = doctorFilter ? appointments.filter((a) => a.doctor_id === doctorFilter) : appointments
  // A long day opens around what is happening now, not at the first finished visit.
  const firstLive = listed.findIndex((a) => a.status !== 'done' && a.status !== 'no_show')
  const from = allRows || listed.length <= DAY_ROWS ? 0
    : Math.min(Math.max(0, (firstLive < 0 ? listed.length : firstLive) - 2), listed.length - DAY_ROWS)
  const shown = allRows ? listed : listed.slice(from, from + DAY_ROWS)
  const after = listed.length - from - shown.length

  const rowNote = (a: (typeof appointments)[number]) => {
    if (a.status === 'done' && paidToday.has(a.patient_id)) return t('today.notePaid', { amount: num.format(paidToday.get(a.patient_id) ?? 0) })
    if ((a.status === 'in_session' || a.status === 'arrived') && owed.has(a.patient_id)) return t('today.noteOwes', { amount: num.format(owed.get(a.patient_id) ?? 0) })
    if (a.status === 'booked') return t(a.confirmed_at ? 'today.noteConfirmed' : 'today.noteUnconfirmed')
    return null
  }

  const instShown = allInst ? sortedAgenda : sortedAgenda.slice(0, INST_ROWS)

  return (
    <section className="page today">
      <header className="today-head">
        <h1>{t(now.getHours() < 12 ? 'today.goodMorning' : 'today.goodEvening', { name: displayName })}</h1>
        <span className="muted">
          {longDate.format(now)}
          {appointments.length > 0 && <> · {t('today.summary', { n: appointments.length, left: coming })}</>}
        </span>
      </header>

      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-top"><span>{t('today.kpiAppointments')}</span><Icon name="calendar" /></div>
          <strong>{appointments.length}</strong>
          <div className="meter"><i style={{ inlineSize: `${appointments.length ? (done / appointments.length) * 100 : 0}%` }} /></div>
          <span className="kpi-note">{t('today.kpiProgress', { done, here, left: coming })}</span>
        </div>
        {seesMoney && (
          <>
            <div className="kpi">
              <div className="kpi-top"><span>{t('today.statCollected')}</span><Icon name="cash" /></div>
              <strong>{num.format(collectedToday)} <small>{t('today.currency')}</small></strong>
              <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
                <polygon points={`0,30 ${spark} 100,30`} />
                <polyline points={spark} />
              </svg>
              <span className="kpi-note">
                {collectedToday === 0 && weekAgo === 0 ? t('today.kpiNoCash')
                  : vsWeekAgo === 0 ? t('today.kpiSame', { day: weekday.format(now) })
                  : t(vsWeekAgo > 0 ? 'today.kpiUp' : 'today.kpiDown', { day: weekday.format(now), amount: money(Math.abs(vsWeekAgo)) })}
              </span>
            </div>
            <div className={`kpi ${overdueAmount > 0 ? 'is-warn' : ''}`}>
              <div className="kpi-top"><span>{t('today.kpiOverdue')}</span><Icon name="clock" /></div>
              <strong>{num.format(overdueAmount)} <small>{t('today.currency')}</small></strong>
              {overdueAmount > 0 && (
                <div className="aging" aria-hidden="true">
                  {aging.map((amount, i) => amount > 0 && <i key={i} style={{ flexGrow: amount }} />)}
                </div>
              )}
              <span className="kpi-note">
                {overdue.length ? t('today.kpiOverdueDetail', { n: overdue.length, p: overduePatients, d: oldest }) : t('today.kpiOverdueNone')}
              </span>
            </div>
          </>
        )}
        <a className="kpi kpi-link" href="#today-follow">
          <div className="kpi-top"><span>{t('today.kpiAttention')}</span><Icon name="alert" /></div>
          <strong>{labs.length + lowStock.length}</strong>
          <div className="kpi-tags">
            {labs.length > 0 && <span className="badge badge-neutral">{t('today.kpiLabs', { n: labs.length })}</span>}
            {lowStock.length === 1 && <span className="badge badge-neutral">{t('today.kpiStockOne', { name: lowStock[0].name ?? '' })}</span>}
            {lowStock.length > 1 && <span className="badge badge-neutral">{t('today.kpiStock', { n: lowStock.length })}</span>}
          </div>
          <span className="kpi-note">{t(labs.length + lowStock.length ? 'today.kpiSee' : 'today.kpiNone')}</span>
        </a>
      </div>

      <div className="today-top">
        {board.length > 0 && (
          <section className="chairs">
            <div className="panel-head">
              <h2>{t('today.chairsNow')}</h2>
              <span className="chairs-clock">{t('today.clock', { time: time(now.toISOString()) })}</span>
            </div>
            <div className="chairs-grid">
              {board.map(({ chair, sitting, waiting, next }) => {
                const a = sitting ?? waiting
                const doctor = a?.doctor_id ? doctorNames.get(a.doctor_id) : next?.doctor_id ? doctorNames.get(next.doctor_id) : null
                const tone = sitting ? 'is-busy' : waiting ? 'is-waiting' : 'is-free'
                const span = sitting ? new Date(sitting.ends_at).getTime() - new Date(sitting.starts_at).getTime() : 0
                const spentMs = sitting ? now.getTime() - new Date(sitting.starts_at).getTime() : 0
                const spent = Math.min(1, Math.max(0, spentMs / (span || 1)))
                return (
                  <div key={chair.id} className={`chair-card ${tone}`}>
                    <div className="chair-top">
                      <span>{[chair.name, doctor].filter(Boolean).join(' · ')}</span>
                      <b>{t(sitting ? 'today.chairBusy' : waiting ? 'today.chairWaiting' : 'today.chairFree')}</b>
                    </div>
                    {sitting && (
                      <>
                        <Link to={`/patients/${sitting.patient_id}`} className="chair-name">{sitting.patientName}</Link>
                        {sitting.planTitle && <span className="chair-sub">{sitting.planTitle}</span>}
                        <div className="meter"><i style={{ inlineSize: `${spent * 100}%` }} /></div>
                        <span className="chair-sub">
                          {t('today.chairProgress', {
                            spent: Math.max(0, Math.round(spentMs / 60_000)),
                            left: Math.max(0, Math.round((span - spentMs) / 60_000)),
                          })}
                        </span>
                      </>
                    )}
                    {!sitting && waiting && (
                      <>
                        <Link to={`/patients/${waiting.patient_id}`} className="chair-name">{waiting.patientName}</Link>
                        <span className="chair-sub">
                          {[waiting.planTitle, t('today.chairBookedFor', { time: time(waiting.starts_at) })].filter(Boolean).join(' · ')}
                        </span>
                        {onSeat && (
                          <button className="chair-btn is-solid" disabled={seating === waiting.id} onClick={() => onSeat(waiting.id)}>
                            {t('today.chairSeat')}
                          </button>
                        )}
                      </>
                    )}
                    {!a && (
                      <>
                        <span className="chair-name">
                          {next ? t('today.chairFreeUntil', { time: time(next.starts_at) }) : t('today.chairFreeRest')}
                        </span>
                        {next && (
                          <span className="chair-sub">
                            {t('today.chairNext', { name: [next.patientName, next.planTitle].filter(Boolean).join(lang === 'en' ? ', ' : '، ') })}
                          </span>
                        )}
                        <Link className="chair-btn" to={`/appointments?new=1&chair=${chair.id}`}>{t('today.chairBookHere')}</Link>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {seesMoney && (
          <section className="panel week">
            <div className="panel-head">
              <h2>{t('today.week')}</h2>
              <span className="kpi-note">{t('today.weekUnit')}</span>
            </div>
            <div className="week-bars">
              {week.map((d, i) => (
                <div key={i} className={`week-bar ${i === 6 ? 'is-today' : ''}`}>
                  <span>{d.amount > 0 ? thousands.format(d.amount / 1000) : '–'}</span>
                  <i style={{ blockSize: `${Math.max(3, (d.amount / weekMax) * 100)}%` }} />
                </div>
              ))}
            </div>
            <div className="week-days">
              {week.map((d, i) => <span key={i}>{i === 6 ? t('today.title') : weekday.format(d.day)}</span>)}
            </div>
            <span className="kpi-note">{t('today.weekNote')}</span>
          </section>
        )}
      </div>

      {nothing && <p className="empty">{t('today.allClear')}</p>}

      <div className="today-cols">
        <div className="today-main">
          {appointments.length > 0 && (
            <section className="panel">
              <div className="panel-head day-head">
                <h2>{t('today.schedule')}</h2>
                <div className="day-tools">
                  {doctorsToday.length > 1 && (
                    <div className="chips">
                      <button className={`chip ${doctorFilter === '' ? 'is-on' : ''}`} onClick={() => setDoctorFilter('')}>
                        {t('today.filterAll')} {appointments.length}
                      </button>
                      {doctorsToday.map((id) => (
                        <button key={id} className={`chip ${doctorFilter === id ? 'is-on' : ''}`} onClick={() => setDoctorFilter(id)}>
                          {doctorNames.get(id) ?? '—'} {appointments.filter((a) => a.doctor_id === id).length}
                        </button>
                      ))}
                    </div>
                  )}
                  <Link className="text-link" to="/appointments">{t('today.openCal')}</Link>
                </div>
              </div>
              {from > 0 && (
                <button className="day-more" onClick={() => setAllRows(true)}>{t('today.earlier', { n: from })}</button>
              )}
              <ul className="work-list day-list">
                {shown.map((a) => {
                  const note = rowNote(a)
                  return (
                    <li key={a.id} className={`day-${a.status}`}>
                      <div className="appt-line">
                        <span className="appt-time">{time(a.starts_at)}</span>
                        <div>
                          <Link to={`/patients/${a.patient_id}`} className="row-link">{a.patientName}</Link>
                          {a.alerts && <span className="day-alert" title={a.alerts}>{a.alerts}</span>}
                          <p className="muted">
                            {[a.planTitle, a.doctor_id ? doctorNames.get(a.doctor_id) : null, chairName.get(a.chair_id)].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                      </div>
                      <div className="day-end">
                        {note && <span className={a.status === 'in_session' ? 'day-note is-strong' : 'day-note'}>{note}</span>}
                        <span className={`badge appt-badge appt-${a.status}`}>{t(apptStatusKey(a.status))}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {after > 0 && (
                <button className="day-more" onClick={() => setAllRows(true)}>
                  {t('today.moreAfter', { n: after, time: time(shown[shown.length - 1].starts_at) })}
                </button>
              )}
            </section>
          )}
        </div>

        <div className="today-side" id="today-follow">
          {bookings}

          {labs.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>{t('today.labTitle')}</h2>
                <Link className="text-link" to="/labs">{t('today.openLabs')}</Link>
              </div>
              <ul className="work-list">
                {labs.map((l) => {
                  const lateDays = l.expected_on ? Math.floor((now.getTime() - dayOnly(l.expected_on).getTime()) / 86_400_000) : 0
                  const step = labProgress[l.stage ?? ''] ?? 0
                  return (
                    <li key={l.id} className="lab-row">
                      <div className="lab-head">
                        <span>
                          <Link to={`/patients/${l.patient_id}`} className="row-link">{l.full_name}</Link>
                          {l.description && <> · {l.description}</>}
                        </span>
                        {lateDays > 0
                          ? <span className="danger-text lab-when">{t('today.labLateDays', { n: lateDays })}</span>
                          : l.expected_on && <span className="muted lab-when">{t('today.labDue', { date: weekday.format(dayOnly(l.expected_on)) })}</span>}
                      </div>
                      {l.at_risk && l.next_appointment_at && (
                        <p className="danger-text">{t('today.labAtRisk', { date: date(l.next_appointment_at) })}</p>
                      )}
                      <div className="steps">
                        {(['today.labStep1', 'today.labStep2', 'today.labStep3'] as const).map((key, i) => (
                          <span key={key} className={i < step ? 'is-done' : ''}><i />{t(key)}</span>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {seesMoney && agenda.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2>{t('today.instTitle')}</h2></div>
              <ul className="work-list">
                {instShown.map((a) => {
                  const late = a.status === 'overdue' || a.status === 'in_grace'
                  return (
                    <li key={a.id}>
                      <div>
                        <Link to={`/patients/${a.patient_id}`} className="row-link">{a.full_name}</Link>
                        <p className={late ? 'danger-text' : 'muted'}>
                          {money(a.remaining)} · {(a.days_overdue ?? 0) > 0
                            ? t('today.instLate', { n: a.days_overdue ?? 0 })
                            : t('today.instDue', { date: a.due_date ? shortDate.format(dayOnly(a.due_date)) : '—' })}
                        </p>
                      </div>
                      {a.whatsapp_phone && a.due_date && (
                        <a className="btn" target="_blank" rel="noreferrer"
                          href={waMessage(a.whatsapp_phone, templates.installment({
                            name: a.full_name ?? '', clinic: clinicName, amount: a.remaining ?? 0,
                            dueDate: a.due_date, overdue: late,
                          }))}>
                          {t('today.remind')}
                        </a>
                      )}
                    </li>
                  )
                })}
              </ul>
              {sortedAgenda.length > instShown.length && (
                <button className="day-more" onClick={() => setAllInst(true)}>
                  {t('today.instMore', { n: sortedAgenda.length - instShown.length })}
                </button>
              )}
            </section>
          )}

          {lowStock.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>{t('today.lowStock', { n: lowStock.length })}</h2>
                <Link className="btn" to="/materials">{t('today.openMaterials')}</Link>
              </div>
              <ul className="work-list">
                {lowStock.map((m) => (
                  <li key={m.material_id}>
                    <div>
                      <strong>{m.name}</strong>
                      <p className="muted">{t('today.stockLeft', { n: m.on_hand ?? 0, unit: m.unit ?? '', min: m.min_stock ?? 0 })}</p>
                    </div>
                    {m.supplier_phone && (
                      <a className="btn btn-small" target="_blank" rel="noreferrer"
                        href={waMessage(m.supplier_phone, templates.orderMaterial({ clinic: clinicName, material: m.name ?? '', unit: m.unit ?? '' }))}>
                        {t('mat.order')}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <div className="patient-grid">
        {unscheduled.length > 0 && (
          <section className="panel">
            <h2>{t('today.unscheduled', { n: unscheduled.length })}</h2>
            <ul className="work-list">
              {unscheduled.map((u) => (
                <li key={u.treatment_plan_id}>
                  <div>
                    <Link to={`/patients/${u.patient_id}`} className="row-link">{u.full_name}</Link>
                    <p className="muted">
                      <Link to={`/plans/${u.treatment_plan_id}`}>{u.title}</Link>
                      {' — '}{t('today.remainingWork', { n: u.remaining_items ?? 0, amount: money(u.remaining_value) })}
                    </p>
                  </div>
                  <div className="work-meta">
                    <span className="muted">
                      {u.last_session_at ? t('today.lastSession', { date: date(u.last_session_at) }) : t('today.noSessionYet')}
                    </span>
                    {u.phone && (
                      <a className="btn btn-small" target="_blank" rel="noreferrer"
                        href={waMessage(u.phone, templates.nextSession({ name: u.full_name ?? '', clinic: clinicName, plan: u.title ?? '' }))}>
                        {t('today.book')}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recall.length > 0 && (
          <section className="panel">
            <h2>{t('today.recall', { n: recall.length })}</h2>
            <ul className="work-list">
              {recall.map((r) => (
                <li key={r.patient_id}>
                  <div>
                    <Link to={`/patients/${r.patient_id}`} className="row-link">{r.full_name}</Link>
                    <p className="muted">{r.recall_type === 'perio' ? t('today.recallPerio') : t('today.recallRoutine')}</p>
                  </div>
                  <div className="work-meta">
                    <span className={r.status === 'overdue' ? 'danger-text' : 'muted'}>
                      {r.status === 'overdue'
                        ? t('today.recallOverdue', { n: r.days_overdue ?? 0 })
                        : t('today.recallDue', { date: date(r.next_recall_due) })}
                    </span>
                    {r.whatsapp_phone && (
                      <a className="btn btn-small" target="_blank" rel="noreferrer"
                        href={waMessage(r.whatsapp_phone, templates.recall({ name: r.full_name ?? '', clinic: clinicName }))}>
                        {t('today.remind')}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  )
}
