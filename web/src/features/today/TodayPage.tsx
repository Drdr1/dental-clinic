import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FollowUpCard, ReviewCell } from '../reviews/ReviewBits'
import { getReviewsFor } from '../reviews/api'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { PendingBookings } from '../booking/PendingBookings'
import { templates, waMessage } from '../../lib/whatsapp'
import { installmentStatusKey } from '../payments/labels'
import { getClinicCalendar, getClinicDoctors, setAppointmentStatus, type DayAppointment } from '../appointments/api'
import { apptStatusKey } from '../appointments/labels'
import { getToday, type DayTotal } from './api'

const agendaOrder = ['overdue', 'in_grace', 'due', 'upcoming']
const minutes = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }

export function TodayPage() {
  const member = useMember()
  const { clinicId, clinicName, role } = member
  // Clinic-wide money belongs to whoever handles it: the owner and reception.
  // Doctors still see each patient's own balance, which the session lock depends on.
  const seesMoney = role !== 'doctor'
  const { t, money, date, time } = useI18n()
  const q = useQuery({ queryKey: ['today', clinicId], queryFn: () => getToday(clinicId), refetchInterval: 60_000 })
  const calendar = useQuery({ queryKey: ['calendar', clinicId], queryFn: () => getClinicCalendar(clinicId) })
  const doctors = useQuery({ queryKey: ['clinic-doctors', clinicId], queryFn: () => getClinicDoctors(clinicId) })
  const doneIds = (q.data?.appointments ?? []).filter((a) => a.status === 'done').map((a) => a.id)
  const reviews = useQuery({
    queryKey: ['reviews-today', clinicId, doneIds.join(',')], queryFn: () => getReviewsFor(clinicId, doneIds),
    enabled: member.reviewsEnabled && doneIds.length > 0,
  })
  const reviewOf = new Map((reviews.data ?? []).map((r) => [r.appointment_id, r]))
  const [doctorFilter, setDoctorFilter] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(id) }, [])

  if (q.isPending) return <section className="page"><Skeleton variant="cards" rows={4} /><Skeleton rows={4} /></section>
  if (q.isError) return <section className="page"><ErrorNote error={q.error} onRetry={() => q.refetch()} /></section>

  const { agenda, recall, labs, unscheduled, planTitles, appointments, lowStock, collectedToday, week } = q.data
  const doctorName = new Map((doctors.data ?? []).map((d) => [d.user_id, d.display_name]))
  const chairName = new Map((calendar.data?.chairs ?? []).map((c) => [c.id, c.name]))

  const live = appointments.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
  const done = live.filter((a) => a.status === 'done').length
  const here = live.filter((a) => a.status === 'arrived' || a.status === 'in_session').length
  const left = live.filter((a) => a.status === 'booked').length

  const overdue = agenda.filter((a) => a.status === 'overdue')
  const overdueAmount = overdue.reduce((sum, a) => sum + (a.remaining ?? 0), 0)
  const overduePatients = new Set(overdue.map((a) => a.patient_id)).size
  const oldest = Math.max(0, ...overdue.map((a) => a.days_overdue ?? 0))
  // The bar is the late share of everything due on the installment list.
  const dueAmount = agenda.reduce((sum, a) => sum + (a.remaining ?? 0), 0)
  const yesterday = week.length > 1 ? week[week.length - 2].total : 0
  const diff = collectedToday - yesterday

  // "د. محمد درديري" greets as "د. محمد", not just "د.".
  const nameParts = (member.displayName || '').trim().split(/\s+/)
  const isTitle = /^(د\.?|دكتور|دكتورة|dr\.?)$/i.test(nameParts[0] ?? '')
  const firstName = (isTitle ? nameParts.slice(0, 2) : nameParts.slice(0, 1)).join(' ')
  const greeting = now.getHours() < 14 ? 'today.greetMorning' : 'today.greetEvening'
  const nowMin = now.getHours() * 60 + now.getMinutes()

  const sortedAgenda = [...agenda].sort(
    (a, b) => agendaOrder.indexOf(a.status ?? '') - agendaOrder.indexOf(b.status ?? '') ||
      (a.due_date ?? '').localeCompare(b.due_date ?? ''),
  )
  const scheduleDoctors = [...new Set(appointments.map((a) => a.doctor_id).filter((d): d is string => !!d))]
  const shown = doctorFilter ? appointments.filter((a) => a.doctor_id === doctorFilter) : appointments

  return (
    <section className="page today">
      <header className="today-head">
        <div>
          <h1>{t(greeting, { name: firstName })}</h1>
          <p className="muted">{t('today.subtitle', { date: date(now.toISOString()), n: live.length, left })}</p>
        </div>
      </header>

      <div className="kpis">
        <article className="kpi">
          <div className="kpi-top"><span>{t('today.kpiAppointments')}</span><span className="kpi-icon"><Icon name="calendar" /></span></div>
          <strong className="kpi-value">{live.length}</strong>
          <div className="kpi-bar"><span style={{ width: `${live.length ? (done / live.length) * 100 : 0}%` }} /></div>
          <p className="kpi-sub">{t('today.kpiAppointmentsSub', { done, here, left })}</p>
        </article>

        {seesMoney && (
          <article className="kpi">
            <div className="kpi-top"><span>{t('today.kpiCollected')}</span><span className="kpi-icon"><Icon name="cash" /></span></div>
            <strong className="kpi-value">{money(collectedToday)}</strong>
            <Sparkline days={week} />
            <p className="kpi-sub">
              {diff === 0 ? t('today.sameAsYesterday')
                : t(diff > 0 ? 'today.aboveYesterday' : 'today.belowYesterday', { amount: money(Math.abs(diff)) })}
            </p>
          </article>
        )}

        {seesMoney && (
          <article className="kpi">
            <div className="kpi-top"><span>{t('today.kpiOverdue')}</span><span className="kpi-icon"><Icon name="clock" /></span></div>
            <strong className={`kpi-value${overdueAmount > 0 ? ' is-danger' : ''}`}>{money(overdueAmount)}</strong>
            <div className="kpi-bar is-bad"><span style={{ width: `${dueAmount ? (overdueAmount / dueAmount) * 100 : 0}%` }} /></div>
            <p className="kpi-sub">
              {overdue.length ? t('today.kpiOverdueSub', { n: overdue.length, p: overduePatients, d: oldest }) : t('today.kpiOverdueNone')}
            </p>
          </article>
        )}

        <article className="kpi">
          <div className="kpi-top"><span>{t('today.kpiAttention')}</span><span className="kpi-icon"><Icon name="alert" /></span></div>
          <strong className="kpi-value">{labs.length + lowStock.length}</strong>
          <div className="kpi-chips">
            {labs.length > 0 && <Link to="/labs" className="chip chip-link">{t('today.chipLabs', { n: labs.length })}</Link>}
            {lowStock.length > 0 && <Link to="/materials" className="chip chip-link">{t('today.chipStock', { n: lowStock.length })}</Link>}
          </div>
          {labs.length + lowStock.length === 0 && <p className="kpi-sub">{t('today.kpiAttentionNone')}</p>}
        </article>
      </div>

      <div className="today-grid">
        <ChairsNow chairs={(calendar.data?.chairs ?? []).filter((c) => c.active || appointments.some((a) => a.chair_id === c.id))} appointments={appointments} nowMin={nowMin}
          clock={time(now.toISOString())} doctorName={doctorName} />
        {seesMoney && <WeekChart days={week} />}
      </div>

      <div className="today-grid today-grid-main">
        <section className="panel">
          <div className="panel-head">
            <h2>{t('today.schedule')}</h2>
            <div className="chips">
              <button className={`chip${doctorFilter === null ? ' on' : ''}`} onClick={() => setDoctorFilter(null)}>
                {t('today.all')} {appointments.length}
              </button>
              {scheduleDoctors.map((d) => (
                <button key={d} className={`chip${doctorFilter === d ? ' on' : ''}`} onClick={() => setDoctorFilter(d)}>
                  {doctorName.get(d) ?? '—'} {appointments.filter((a) => a.doctor_id === d).length}
                </button>
              ))}
              <Link to="/appointments" className="link-strong">{t('today.openCalendar')}</Link>
            </div>
          </div>
          {shown.length === 0 && <p className="empty">{t('today.noAppointments')}</p>}
          <ul className="sched">
            {shown.map((a) => {
              const meta = [a.planTitle, a.doctor_id && doctorName.get(a.doctor_id), a.chair_id && chairName.get(a.chair_id)].filter(Boolean).join(' · ')
              return (
                <li key={a.id} className={a.status === 'in_session' ? 'is-live' : ''}>
                  <span className="sched-time">{time(a.starts_at)}</span>
                  <div className="sched-who">
                    <div>
                      <Link to={`/patients/${a.patient_id}`} className="row-link">{a.patientName}</Link>
                      {a.alerts && <span className="badge badge-alert">{a.alerts}</span>}
                    </div>
                    {meta && <p className="muted">{meta}</p>}
                  </div>
                  {member.reviewsEnabled && a.status === 'done'
                    ? <ReviewCell appointmentId={a.id} patientName={a.patientName} phone={a.patientPhone} review={reviewOf.get(a.id)} />
                    : <span className={`badge appt-badge appt-${a.status}`}>{t(apptStatusKey(a.status))}</span>}
                </li>
              )
            })}
          </ul>
          {left > 0 && <p className="muted small">{t('today.leftAfterNow', { n: appointments.filter((a) => a.status === 'booked' && minutes(a.starts_at) > nowMin).length })}</p>}
        </section>

        <div className="today-side">
          <FollowUpCard />
          <PendingBookings />

          {labs.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>{t('today.labTitle')}</h2>
                <Link to="/labs" className="link-strong">{t('today.openLabs')}</Link>
              </div>
              <ul className="lab-list">
                {labs.map((l) => {
                  const steps = [
                    { label: t('today.stageSent'), on: !!l.sent_on },
                    ...(l.needs_tryin ? [{ label: t('today.stageTryin'), on: !!l.tryin_done_on }] : []),
                    { label: t('today.stageBack'), on: !!l.received_on },
                  ]
                  return (
                    <li key={l.id}>
                      <div className="lab-line">
                        <Link to={`/patients/${l.patient_id}`} className="row-link">{l.full_name} · {l.description}</Link>
                        {l.at_risk && l.next_appointment_at
                          ? <span className="danger-text small">{t('today.labAtRisk', { date: date(l.next_appointment_at) })}</span>
                          : (l.days_late ?? 0) > 0 && <span className="danger-text small">{t('today.lateDays', { n: l.days_late ?? 0 })}</span>}
                      </div>
                      <div className="steps" style={{ ['--n' as string]: steps.length }}>
                        {steps.map((s, i) => <span key={i} className={s.on ? 'on' : ''}><i />{s.label}</span>)}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {seesMoney && agenda.length > 0 && (
            <section className="panel">
              <h2>{t('today.dueTitle')}</h2>
              <ul className="work-list">
                {sortedAgenda.map((a) => (
                  <li key={a.id}>
                    <div>
                      <Link to={`/patients/${a.patient_id}`} className="row-link">{a.full_name}</Link>
                      <p className={a.status === 'overdue' || a.status === 'in_grace' ? 'danger-text small' : 'muted small'}>
                        {money(a.remaining)} · {(a.days_overdue ?? 0) > 0
                          ? t('today.daysLate', { n: a.days_overdue ?? 0 })
                          : `${t(installmentStatusKey(a.status))} ${date(a.due_date)}`}
                        {a.treatment_plan_id && planTitles.get(a.treatment_plan_id) ? ` · ${planTitles.get(a.treatment_plan_id)}` : ''}
                      </p>
                    </div>
                    {a.whatsapp_phone && a.due_date && (
                      <a className="btn btn-small" target="_blank" rel="noreferrer"
                        href={waMessage(a.whatsapp_phone, templates.installment({
                          name: a.full_name ?? '', clinic: clinicName, amount: a.remaining ?? 0,
                          dueDate: a.due_date, overdue: a.status === 'overdue' || a.status === 'in_grace',
                        }))}>
                        {t('today.remind')}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {unscheduled.length > 0 && (
            <section className="panel">
              <h2>{t('today.unscheduled', { n: unscheduled.length })}</h2>
              <ul className="work-list">
                {unscheduled.map((u) => (
                  <li key={u.treatment_plan_id}>
                    <div>
                      <Link to={`/patients/${u.patient_id}`} className="row-link">{u.full_name}</Link>
                      <p className="muted small">
                        <Link to={`/plans/${u.treatment_plan_id}`}>{u.title}</Link>
                        {' · '}{t('today.remainingWork', { n: u.remaining_items ?? 0, amount: money(u.remaining_value) })}
                      </p>
                    </div>
                    {u.phone && (
                      <a className="btn btn-small" target="_blank" rel="noreferrer"
                        href={waMessage(u.phone, templates.nextSession({ name: u.full_name ?? '', clinic: clinicName, plan: u.title ?? '' }))}>
                        {t('today.book')}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {lowStock.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>{t('today.lowStock', { n: lowStock.length })}</h2>
                <Link to="/materials" className="link-strong">{t('today.openMaterials')}</Link>
              </div>
              <ul className="work-list">
                {lowStock.map((m) => (
                  <li key={m.material_id}>
                    <div>
                      <strong>{m.name}</strong>
                      <p className="muted small">{t('today.stockLeft', { n: m.on_hand ?? 0, unit: m.unit ?? '', min: m.min_stock ?? 0 })}</p>
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

          {recall.length > 0 && (
            <section className="panel">
              <h2>{t('today.recall', { n: recall.length })}</h2>
              <ul className="work-list">
                {recall.map((r) => (
                  <li key={r.patient_id}>
                    <div>
                      <Link to={`/patients/${r.patient_id}`} className="row-link">{r.full_name}</Link>
                      <p className={r.status === 'overdue' ? 'danger-text small' : 'muted small'}>
                        {r.recall_type === 'perio' ? t('today.recallPerio') : t('today.recallRoutine')}
                        {' · '}
                        {r.status === 'overdue'
                          ? t('today.recallOverdue', { n: r.days_overdue ?? 0 })
                          : t('today.recallDue', { date: date(r.next_recall_due) })}
                      </p>
                    </div>
                    {r.whatsapp_phone && (
                      <a className="btn btn-small" target="_blank" rel="noreferrer"
                        href={waMessage(r.whatsapp_phone, templates.recall({ name: r.full_name ?? '', clinic: clinicName }))}>
                        {t('today.remind')}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </section>
  )
}

/** One card per chair: who is in it now, who just arrived for it, or until when it is free. */
function ChairsNow({ chairs, appointments, nowMin, clock, doctorName }: {
  chairs: { id: string; name: string }[]
  appointments: DayAppointment[]
  nowMin: number
  clock: string
  doctorName: Map<string, string>
}) {
  const { t, time } = useI18n()
  const qc = useQueryClient()
  const admit = useMutation({
    mutationFn: (id: string) => setAppointmentStatus(id, 'in_session'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['today'] }); qc.invalidateQueries({ queryKey: ['day'] }) },
  })
  if (!chairs.length) return null

  return (
    <section className="chairs">
      <div className="chairs-head">
        <h2>{t('today.chairs')}</h2>
        <span>{t('today.clock', { time: clock })}</span>
      </div>
      {admit.isError && <ErrorNote error={admit.error} />}
      <div className="chairs-row">
        {chairs.map((c) => {
          const mine = appointments.filter((a) => a.chair_id === c.id && a.status !== 'cancelled' && a.status !== 'no_show')
          const inSession = mine.find((a) => a.status === 'in_session')
          const arrived = mine.find((a) => a.status === 'arrived')
          const next = mine.find((a) => a.status === 'booked' && minutes(a.starts_at) >= nowMin - 15)
          const a = inSession ?? arrived
          const doc = a?.doctor_id ? doctorName.get(a.doctor_id) : next?.doctor_id ? doctorName.get(next.doctor_id) : null
          const label = [c.name, doc].filter(Boolean).join(' · ')

          if (inSession) {
            const start = minutes(inSession.starts_at)
            const end = inSession.ends_at ? minutes(inSession.ends_at) : start + 30
            const pct = Math.min(100, Math.max(0, ((nowMin - start) / Math.max(1, end - start)) * 100))
            return (
              <article key={c.id} className="chair is-busy">
                <div className="chair-top"><span>{label}</span><b>{t('today.chairBusy')}</b></div>
                <Link to={`/patients/${inSession.patient_id}`} className="chair-name">{inSession.patientName}</Link>
                {inSession.planTitle && <p>{inSession.planTitle}</p>}
                <div className="chair-bar"><span style={{ width: `${pct}%` }} /></div>
                <p>{t('today.startedAgo', { n: Math.max(0, nowMin - start), left: Math.max(0, end - nowMin) })}</p>
              </article>
            )
          }
          if (arrived) {
            return (
              <article key={c.id} className="chair">
                <div className="chair-top"><span>{label}</span><b>{t('today.chairArrived')}</b></div>
                <Link to={`/patients/${arrived.patient_id}`} className="chair-name">{arrived.patientName}</Link>
                <p>{[arrived.planTitle, t('today.at', { time: time(arrived.starts_at) })].filter(Boolean).join(' · ')}</p>
                <button className="btn chair-btn" disabled={admit.isPending} onClick={() => admit.mutate(arrived.id)}>
                  {t('today.admit')}
                </button>
              </article>
            )
          }
          return (
            <article key={c.id} className="chair is-free">
              <div className="chair-top"><span>{label}</span><b>{t('today.chairFree')}</b></div>
              <strong className="chair-name">
                {next ? t('today.freeUntil', { time: time(next.starts_at) }) : t('today.freeAllDay')}
              </strong>
              {next && <p>{t('today.nextUp', { name: next.patientName })}</p>}
              <Link to="/appointments?new=1" className="btn chair-btn chair-btn-line">{t('today.bookChair')}</Link>
            </article>
          )
        })}
      </div>
    </section>
  )
}

/** Seven days of takings as bars, today in ink. Owner and reception only. */
function WeekChart({ days }: { days: DayTotal[] }) {
  const { t, lang } = useI18n()
  const max = Math.max(1, ...days.map((d) => d.total))
  const fmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'long' })
  return (
    <section className="panel week">
      <div className="panel-head">
        <h2>{t('today.week')}</h2>
        <span className="muted small">{t('today.weekUnit')}</span>
      </div>
      <div className="week-bars">
        {days.map((d, i) => {
          const isToday = i === days.length - 1
          return (
            <div key={d.day} className={`week-col${isToday ? ' is-today' : ''}`}>
              <span className="week-val">{d.total ? (d.total / 1000).toLocaleString('en', { maximumFractionDigits: 1 }) : ''}</span>
              <span className="week-bar" style={{ height: `${Math.max(2, (d.total / max) * 100)}%` }} />
              <span className="week-day">{isToday ? t('today.today') : fmt.format(new Date(d.day + 'T12:00:00'))}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Sparkline({ days }: { days: DayTotal[] }) {
  const max = Math.max(1, ...days.map((d) => d.total))
  const pts = days.map((d, i) => `${(i / Math.max(1, days.length - 1)) * 100},${30 - (d.total / max) * 26}`)
  return (
    <svg className="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,32 ${pts.join(' ')} 100,32`} />
      <polyline points={pts.join(' ')} />
    </svg>
  )
}
