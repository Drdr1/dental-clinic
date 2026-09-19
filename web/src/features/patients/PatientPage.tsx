import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { ageFrom, whatsappLink } from '../../lib/phone'
import { ErrorNote } from '../../components/ErrorNote'
import { PlanStatusBadge } from '../../components/PlanStatusBadge'
import { getPatientFile } from './api'

export function PatientPage() {
  const { id = '' } = useParams()
  const { t, money, date } = useI18n()

  const file = useQuery({ queryKey: ['patient', id], queryFn: () => getPatientFile(id), enabled: !!id })

  if (file.isPending) return <section className="page"><p className="muted">{t('common.loading')}</p></section>
  if (file.isError) return <section className="page"><ErrorNote error={file.error} onRetry={() => file.refetch()} /></section>

  const { patient, plans, balances } = file.data
  if (!patient) {
    return (
      <section className="page">
        <p className="empty">{t('patient.notFound')}</p>
        <Link to="/patients">{t('common.back')}</Link>
      </section>
    )
  }

  const age = ageFrom(patient.date_of_birth)
  const today = new Date().toISOString().slice(0, 10)
  const recallOverdue = !!patient.next_recall_due && patient.next_recall_due < today

  return (
    <section className="page patient">
      <Link to="/patients" className="back-link">{t('common.back')}</Link>

      <header className="patient-head">
        <div>
          <h1>{patient.full_name}</h1>
          <p className="patient-meta">
            <span dir="ltr">{patient.phone}</span>
            {age !== null && <span>{t('patient.age', { n: age })}</span>}
          </p>
        </div>
        <div className="patient-actions">
          <a className="btn" href={`tel:${patient.phone}`}>{t('patient.call')}</a>
          <a className="btn" href={whatsappLink(patient.whatsapp_phone ?? patient.phone)} target="_blank" rel="noreferrer">
            {t('patient.whatsapp')}
          </a>
        </div>
      </header>

      {patient.medical_alerts && (
        <div className="medical-alert" role="note">
          <strong>{t('patient.alertTitle')}</strong>
          <p>{patient.medical_alerts}</p>
        </div>
      )}

      <div className="patient-grid">
        <section className="panel">
          <h2>{t('patient.balance')}</h2>
          {balances.length === 0 && <p className="muted">{t('patient.balanceEmpty')}</p>}
          {balances.map((b) => {
            const plan = plans.find((p) => p.treatment_plan_id === b.treatment_plan_id)
            return (
              <div key={b.installment_plan_id} className={`balance ${b.sessions_locked ? 'is-locked' : ''}`}>
                <h3>{plan?.title}</h3>
                <dl className="figures">
                  <div><dt>{t('patient.outstanding')}</dt><dd>{money(b.outstanding)}</dd></div>
                  <div><dt>{t('patient.paid')}</dt><dd>{money(b.total_paid)}</dd></div>
                  <div className={(b.overdue_amount ?? 0) > 0 ? 'is-overdue' : ''}>
                    <dt>{t('patient.overdueAmount')}</dt><dd>{money(b.overdue_amount)}</dd>
                  </div>
                  <div><dt>{t('patient.nextDue')}</dt><dd>{date(b.next_due_date)}</dd></div>
                </dl>
                {b.sessions_locked && <p className="lock-note">{t('patient.locked')}</p>}
              </div>
            )
          })}
        </section>

        <section className="panel">
          <h2>{t('patient.plans')}</h2>
          {plans.length === 0 && <p className="muted">{t('patient.plansEmpty')}</p>}
          <ul className="plan-list">
            {plans.map((p) => (
              <li key={p.treatment_plan_id}>
                <div className="plan-line">
                  <span className="plan-title">{p.title}</span>
                  <PlanStatusBadge status={p.status} />
                </div>
                <div className="plan-sub">
                  <span>{money(p.net_total)}</span>
                  <span className={p.consent_signed ? 'ok-text' : 'muted'}>
                    {p.consent_signed ? t('patient.consentSigned') : t('patient.consentMissing')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>{t('patient.recall')}</h2>
          <p className={recallOverdue ? 'danger-text' : ''}>
            {patient.next_recall_due
              ? recallOverdue
                ? t('patient.recallOverdue', { date: date(patient.next_recall_due) })
                : date(patient.next_recall_due)
              : t('patient.recallNone')}
          </p>
        </section>
      </div>
    </section>
  )
}
