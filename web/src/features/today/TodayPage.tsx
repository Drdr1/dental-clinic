import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { templates, waMessage } from '../../lib/whatsapp'
import { installmentStatusKey, installmentTone } from '../payments/labels'
import { getToday } from './api'
import { apptStatusKey } from '../appointments/labels'
import { minutesOfDay, minutesToTime } from '../appointments/time'

const agendaOrder = ['overdue', 'in_grace', 'due', 'upcoming']

export function TodayPage() {
  const { clinicId, clinicName } = useMember()
  const { t, money, date } = useI18n()
  const q = useQuery({ queryKey: ['today', clinicId], queryFn: () => getToday(clinicId), refetchInterval: 5 * 60_000 })

  if (q.isPending) return <section className="page"><p className="muted">{t('common.loading')}</p></section>
  if (q.isError) return <section className="page"><ErrorNote error={q.error} onRetry={() => q.refetch()} /></section>

  const { agenda, recall, labs, unscheduled, planTitles, appointments } = q.data
  const sortedAgenda = [...agenda].sort(
    (a, b) => agendaOrder.indexOf(a.status ?? '') - agendaOrder.indexOf(b.status ?? '') ||
      (a.due_date ?? '').localeCompare(b.due_date ?? ''),
  )
  const nothing = !agenda.length && !recall.length && !labs.length && !unscheduled.length && !appointments.length

  return (
    <section className="page today">
      <header className="page-head">
        <h1>{t('today.title')}</h1>
        <span className="muted">{date(new Date().toISOString())}</span>
      </header>

      {nothing && <p className="empty">{t('today.allClear')}</p>}

      {appointments.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>{t('today.appointments', { n: appointments.length })}</h2>
            <Link className="btn" to="/appointments">{t('today.openCalendar')}</Link>
          </div>
          <ul className="work-list">
            {appointments.map((a) => (
              <li key={a.id}>
                <div className="appt-line">
                  <span className="appt-time" dir="ltr">{minutesToTime(minutesOfDay(a.starts_at))}</span>
                  <div>
                    <Link to={`/patients/${a.patient_id}`} className="row-link">{a.patientName}</Link>
                    {a.alerts && <span className="alert-dot" aria-label={t('patients.alert')} />}
                    {a.planTitle && <p className="muted">{a.planTitle}</p>}
                  </div>
                </div>
                <span className={`badge appt-badge appt-${a.status}`}>{t(apptStatusKey(a.status))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {labs.length > 0 && (
        <section className="panel panel-alert">
          <h2>{t('today.labs', { n: labs.length })}</h2>
          <ul className="work-list">
            {labs.map((l) => (
              <li key={l.id}>
                <div>
                  <Link to={`/patients/${l.patient_id}`} className="row-link">{l.full_name}</Link>
                  <p className="muted">{l.description} — {l.lab_name}</p>
                </div>
                <div className="work-meta">
                  {l.at_risk && l.next_appointment_at && (
                    <span className="badge badge-danger">{t('today.labAtRisk', { date: date(l.next_appointment_at) })}</span>
                  )}
                  {l.status === 'late' && <span className="badge badge-warn">{t('today.labLate', { date: date(l.expected_on) })}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {agenda.length > 0 && (
        <section className="panel">
          <h2>{t('today.installments', { n: agenda.length })}</h2>
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>{t('patients.col.name')}</th>
                  <th>{t('today.col.plan')}</th>
                  <th>{t('inst.col.due')}</th>
                  <th className="num">{t('inst.col.remaining')}</th>
                  <th>{t('inst.col.status')}</th>
                  <th aria-label={t('patient.whatsapp')} />
                </tr>
              </thead>
              <tbody>
                {sortedAgenda.map((a) => (
                  <tr key={a.id}>
                    <td><Link to={`/patients/${a.patient_id}`} className="row-link">{a.full_name}</Link></td>
                    <td className="muted">
                      {(a.treatment_plan_id && planTitles.get(a.treatment_plan_id)) || ''}
                      {' — '}
                      {a.is_down_payment ? t('inst.downPayment') : t('inst.number', { n: a.seq ?? 0 })}
                    </td>
                    <td>{date(a.due_date)}</td>
                    <td className="num">{money(a.remaining)}</td>
                    <td>
                      <span className={`badge badge-${installmentTone[a.status ?? 'upcoming']}`}>{t(installmentStatusKey(a.status))}</span>
                      {(a.days_overdue ?? 0) > 0 && <span className="partial-note">{t('today.daysLate', { n: a.days_overdue ?? 0 })}</span>}
                    </td>
                    <td className="num">
                      {a.whatsapp_phone && a.due_date && (
                        <a className="btn btn-small" target="_blank" rel="noreferrer"
                          href={waMessage(a.whatsapp_phone, templates.installment({
                            name: a.full_name ?? '', clinic: clinicName, amount: a.remaining ?? 0,
                            dueDate: a.due_date, overdue: a.status === 'overdue' || a.status === 'in_grace',
                          }))}>
                          {t('today.remind')}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    </section>
  )
}
