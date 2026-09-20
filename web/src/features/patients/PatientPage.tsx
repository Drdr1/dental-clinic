import { todayLocal } from '../../lib/dates'
import { Link, useParams } from 'react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { ageFrom, whatsappLink } from '../../lib/phone'
import { ErrorNote } from '../../components/ErrorNote'
import { PlanStatusBadge } from '../../components/PlanStatusBadge'
import { useMember } from '../auth/AuthProvider'
import { getPatientLedger } from '../payments/api'
import { InstallmentPlanCard } from '../payments/InstallmentPlanCard'
import { NewPlanDialog } from '../plans/NewPlanDialog'
import { PatientAppointments } from '../appointments/PatientAppointments'
import { PatientLabCases } from '../labs/PatientLabCases'
import { PatientForms } from '../forms/PatientForms'
import { SessionDialog } from '../sessions/SessionDialog'
import { getPatientFile } from './api'

export function PatientPage() {
  const { id = '' } = useParams()
  const { t, money, date } = useI18n()

  const { clinicId } = useMember()
  const [dialog, setDialog] = useState<'plan' | 'visit' | null>(null)
  const file = useQuery({ queryKey: ['patient', id], queryFn: () => getPatientFile(id), enabled: !!id })
  const ledger = useQuery({
    queryKey: ['ledger', id],
    queryFn: () => getPatientLedger(id, clinicId),
    enabled: !!id,
  })

  if (file.isPending) return <section className="page"><p className="muted">{t('common.loading')}</p></section>
  if (file.isError) return <section className="page"><ErrorNote error={file.error} onRetry={() => file.refetch()} /></section>

  const { patient, plans, balances, perSession } = file.data
  if (!patient) {
    return (
      <section className="page">
        <p className="empty">{t('patient.notFound')}</p>
        <Link to="/patients">{t('common.back')}</Link>
      </section>
    )
  }

  const age = ageFrom(patient.date_of_birth)
  const today = todayLocal()
  const recallOverdue = !!patient.next_recall_due && patient.next_recall_due < today
  // Clinic rule: recall pauses during active treatment and restarts when the plan is completed.
  const inTreatment = plans.some((p) => p.status === 'active')

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
        <section className="panel panel-wide">
          <h2>{t('patient.balance')}</h2>
          {balances.length === 0 && perSession.length === 0 && <p className="muted">{t('patient.balanceEmpty')}</p>}
          {perSession.length > 0 && (
            <div className="plan-card">
              <h3>{t('patient.perSessionTitle')}</h3>
              <ul className="work-list">
                {perSession.map((b) => (
                  <li key={b.treatment_plan_id}>
                    <div>
                      <Link to={`/plans/${b.treatment_plan_id}`} className="row-link">{b.title}</Link>
                      <p className="muted">{t('patient.perSessionPaid', { paid: money(b.paid), total: money(b.net_total) })}</p>
                    </div>
                    <div className="work-meta">
                      <strong>{t('patient.perSessionOwed', { amount: money(b.outstanding) })}</strong>
                      <Link className="btn btn-small" to={`/plans/${b.treatment_plan_id}`}>{t('pay.open')}</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ledger.isError && <ErrorNote error={ledger.error} onRetry={() => ledger.refetch()} />}
          {balances.map((b) => (
            <InstallmentPlanCard
              key={b.installment_plan_id}
              summary={b}
              planTitle={plans.find((p) => p.treatment_plan_id === b.treatment_plan_id)?.title ?? ''}
              patientId={id}
              schedule={(ledger.data?.installments ?? []).filter((r) => r.installment_plan_id === b.installment_plan_id)}
              payments={(ledger.data?.payments ?? []).filter((p) => p.installment_plan_id === b.installment_plan_id)}
              staffNames={ledger.data?.staffNames ?? new Map()}
            />
          ))}
        </section>

        <PatientAppointments patient={{
          id: patient.id, full_name: patient.full_name, phone: patient.phone, medical_alerts: patient.medical_alerts,
        }} />

        <section className="panel">
          <div className="panel-head">
            <h2>{t('patient.plans')}</h2>
            <button className="btn" onClick={() => setDialog('plan')}>{t('plan.new')}</button>
          </div>
          {plans.length === 0 && <p className="muted">{t('patient.plansEmpty')}</p>}
          <ul className="plan-list">
            {plans.map((p) => (
              <li key={p.treatment_plan_id}>
                <div className="plan-line">
                  <Link to={`/plans/${p.treatment_plan_id}`} className="plan-title row-link">{p.title}</Link>
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

        <PatientForms patient={{
          id: patient.id, full_name: patient.full_name, phone: patient.phone, whatsapp_phone: patient.whatsapp_phone,
        }} />

        <PatientLabCases patient={{
          id: patient.id, full_name: patient.full_name, phone: patient.phone, medical_alerts: patient.medical_alerts,
        }} />

        <section className="panel">
          <div className="panel-head">
            <h2>{t('patient.recall')}</h2>
            <button className="btn" onClick={() => setDialog('visit')}>{t('session.titleVisit')}</button>
          </div>
          <p className={recallOverdue && !inTreatment ? 'danger-text' : ''}>
            {inTreatment
              ? t('patient.recallPaused')
              : patient.next_recall_due
              ? recallOverdue
                ? t('patient.recallOverdue', { date: date(patient.next_recall_due) })
                : date(patient.next_recall_due)
              : t('patient.recallNone')}
          </p>
        </section>
      </div>

      {dialog === 'plan' && <NewPlanDialog patientId={id} onClose={() => setDialog(null)} />}
      {dialog === 'visit' && <SessionDialog patientId={id} plan={null} onClose={() => setDialog(null)} />}
    </section>
  )
}
