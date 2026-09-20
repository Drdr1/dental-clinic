import { todayLocal } from '../../lib/dates'
import { Link, useParams } from 'react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { ageFrom, whatsappLink } from '../../lib/phone'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { PlanStatusBadge } from '../../components/PlanStatusBadge'
import { useMember } from '../auth/AuthProvider'
import { getPatientLedger } from '../payments/api'
import { InstallmentPlanCard } from '../payments/InstallmentPlanCard'
import { NewPlanDialog } from '../plans/NewPlanDialog'
import { PatientAppointments } from '../appointments/PatientAppointments'
import { PatientLabCases } from '../labs/PatientLabCases'
import { PatientForms } from '../forms/PatientForms'
import { PatientAllergies } from '../prescriptions/PatientAllergies'
import { PatientPrescriptions } from '../prescriptions/PatientPrescriptions'
import { SessionDialog } from '../sessions/SessionDialog'
import { getPatientFile } from './api'
import { Timeline } from './Timeline'
import { ToothHistory } from './ToothHistory'
import { PatientFiles } from '../files/PatientFiles'
import { PatientForm } from './PatientForm'
import { getUpcomingForPatient } from '../appointments/api'

export function PatientPage() {
  const { id = '' } = useParams()
  const { t, money, date } = useI18n()

  const { clinicId } = useMember()
  const [dialog, setDialog] = useState<'plan' | 'visit' | 'edit' | null>(null)
  const [tab, setTab] = useState<'overview' | 'treatment' | 'account' | 'files'>('overview')
  const file = useQuery({ queryKey: ['patient', id], queryFn: () => getPatientFile(id), enabled: !!id })
  const upcoming = useQuery({ queryKey: ['appointments', id], queryFn: () => getUpcomingForPatient(id), enabled: !!id })
  const ledger = useQuery({
    queryKey: ['ledger', id],
    queryFn: () => getPatientLedger(id, clinicId),
    enabled: !!id,
  })

  if (file.isPending) return <section className="page"><Skeleton rows={4} variant="cards" /></section>
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
  const owed = balances.reduce((sum, b) => sum + (b.outstanding ?? 0), 0)
    + perSession.reduce((sum, b) => sum + (b.outstanding ?? 0), 0)
  const overdue = balances.reduce((sum, b) => sum + (b.overdue_amount ?? 0), 0)
  const nextAppointment = upcoming.data?.[0]

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
          <button className="btn" onClick={() => setDialog('edit')}>{t('patientForm.edit')}</button>
        </div>
      </header>

      {patient.medical_alerts && (
        <div className="medical-alert" role="note">
          <strong>{t('patient.alertTitle')}</strong>
          <p>{patient.medical_alerts}</p>
        </div>
      )}
      <PatientAllergies patientId={patient.id} groups={patient.allergy_groups ?? []} />

      <div className="info-bar">
        <span><em>{t('patient.nextVisit')}</em>{nextAppointment ? date(nextAppointment.starts_at) : t('common.none')}</span>
        <span className={recallOverdue && !inTreatment ? 'is-danger' : ''}>
          <em>{t('patient.recall')}</em>
          {inTreatment ? t('patient.recallPausedShort') : patient.next_recall_due ? date(patient.next_recall_due) : t('common.none')}
        </span>
        <span className={owed > 0 ? 'is-money' : ''}><em>{t('patient.outstanding')}</em>{owed > 0 ? money(owed) : t('common.none')}</span>
        {overdue > 0 && <span className="is-danger"><em>{t('patient.overdueAmount')}</em>{money(overdue)}</span>}
      </div>

      <nav className="segmented tabs" role="tablist">
        {(['overview', 'treatment', 'account', 'files'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-active' : ''} onClick={() => setTab(k)}>
            {t(`tab.${k}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </nav>

      <div className="patient-grid">
        {tab === 'overview' && (
          <>
            <PatientAppointments patient={{
              id: patient.id, full_name: patient.full_name, phone: patient.phone, medical_alerts: patient.medical_alerts,
            }} />

            <section className="panel panel-wide">
              <div className="panel-head">
                <h2>{t('timeline.title')}</h2>
                <span className="head-actions">
                  <button className="btn" onClick={() => setDialog('visit')}>{t('session.titleVisit')}</button>
                  <button className="btn" onClick={() => setDialog('plan')}>{t('plan.new')}</button>
                </span>
              </div>
              <Timeline patientId={id} />
            </section>
          </>
        )}

        {tab === 'treatment' && (
          <>
            <section className="panel panel-wide">
              <h2>{t('tooth.title')}</h2>
              <ToothHistory patientId={id} />
            </section>

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

            <PatientPrescriptions patient={{
              id: patient.id, full_name: patient.full_name, medical_alerts: patient.medical_alerts,
              allergy_groups: patient.allergy_groups ?? [],
            }} />

            <PatientLabCases patient={{
              id: patient.id, full_name: patient.full_name, phone: patient.phone, medical_alerts: patient.medical_alerts,
            }} />
          </>
        )}

        {tab === 'account' && (
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
        )}

        {tab === 'files' && (
          <>
            <PatientFiles patientId={id} />
            <PatientForms patient={{
              id: patient.id, full_name: patient.full_name, phone: patient.phone, whatsapp_phone: patient.whatsapp_phone,
            }} />
          </>
        )}
      </div>

      {dialog === 'edit' && (
        <PatientForm onClose={() => setDialog(null)} patient={{
          id: patient.id, full_name: patient.full_name, phone: patient.phone, whatsapp_phone: patient.whatsapp_phone,
          gender: patient.gender, date_of_birth: patient.date_of_birth, medical_alerts: patient.medical_alerts,
          source: patient.source, source_note: patient.source_note, payer_id: patient.payer_id,
          recall_interval_months: patient.recall_interval_months,
        }} />
      )}
      {dialog === 'plan' && <NewPlanDialog patientId={id} onClose={() => setDialog(null)} />}
      {dialog === 'visit' && <SessionDialog patientId={id} plan={null} onClose={() => setDialog(null)} />}
    </section>
  )
}
