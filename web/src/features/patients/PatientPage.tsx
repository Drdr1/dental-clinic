import { todayLocal } from '../../lib/dates'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useEffect, useState } from 'react'
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
import { PatientNotes } from './PatientNotes'
import { ToothHistory } from './ToothHistory'
import { PatientFiles } from '../files/PatientFiles'
import { PatientForm } from './PatientForm'
import { PatientDangerZone } from './PatientDangerZone'
import { getClinicDoctors, getUpcomingForPatient } from '../appointments/api'
import { AppointmentDialog } from '../appointments/AppointmentDialog'
import { Icon } from '../../components/Icon'
import { supabase } from '../../lib/supabase'
import { AccountCard, CurrentPlanCard } from './PatientSummaryCards'

export function PatientPage() {
  const { id = '' } = useParams()
  const { t, money, date, time } = useI18n()

  const { clinicId } = useMember()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<'plan' | 'visit' | 'dictate' | 'book' | 'edit' | 'archive' | null>(null)
  const [planTooth, setPlanTooth] = useState<number | null>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    if (!more) return
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest('.user-menu')) setMore(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [more])
  const [tab, setTab] = useState<'overview' | 'treatment' | 'account' | 'files' | 'rx'>(
    () => (['treatment', 'account', 'files', 'rx'].includes(search.get('tab') ?? '') ? search.get('tab') : 'overview') as 'overview')
  const file = useQuery({ queryKey: ['patient', id], queryFn: () => getPatientFile(id), enabled: !!id })
  const upcoming = useQuery({ queryKey: ['appointments', id], queryFn: () => getUpcomingForPatient(id), enabled: !!id })
  const doctors = useQuery({ queryKey: ['clinic-doctors', clinicId], queryFn: () => getClinicDoctors(clinicId) })
  const lastVisit = useQuery({
    queryKey: ['last-visit', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('appointments').select('starts_at').eq('patient_id', id)
        .eq('status', 'done').order('starts_at', { ascending: false }).limit(1)
      if (error) throw error
      return data[0]?.starts_at ?? null
    },
    enabled: !!id,
  })
  const xrays = useQuery({
    queryKey: ['xray-count', id],
    queryFn: async () => {
      const { count, error } = await supabase.from('patient_files').select('id', { count: 'exact', head: true })
        .eq('patient_id', id).eq('kind', 'xray')
      if (error) throw error
      return count ?? 0
    },
    enabled: !!id,
  })
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
  const doctorName = doctors.data?.find((d) => d.user_id === patient?.primary_doctor_id)?.display_name

  return (
    <section className="page patient">
      <nav className="crumbs"><Link to="/patients">{t('patients.title')}</Link><span>/</span><span>{patient.full_name}</span></nav>

      <section className="panel patient-card">
        <div className="patient-top">
          <div className="patient-id">
            <span className="user-avatar big"><Icon name="patients" /></span>
            <div>
              <h1>{patient.full_name}</h1>
              <p className="patient-meta">
                {age !== null && <span>{t('patient.age', { n: age })}</span>}
                <span dir="ltr">{patient.phone}</span>
              </p>
            </div>
          </div>
          <div className="patient-actions">
            <a className="btn" href={whatsappLink(patient.whatsapp_phone ?? patient.phone)} target="_blank" rel="noreferrer">
              {t('patient.whatsapp')}
            </a>
            <button className="btn" onClick={() => setDialog('book')}>{t('patient.book')}</button>
            <button className="btn" onClick={() => setDialog('dictate')}>{t('patient.dictate')}</button>
            <button className="btn btn-primary" onClick={() => setDialog('visit')}>{t('patient.newSession')}</button>
            <div className="user-menu">
              <button className="btn icon-square" aria-label={t('nav.more')} aria-expanded={more} onClick={() => setMore((v) => !v)}>
                <Icon name="more" />
              </button>
              {more && (
                <div className="user-pop" role="menu">
                  <a role="menuitem" className="phone-only-inline" href={`tel:${patient.phone}`}>{t('patient.call')}</a>
                  <button role="menuitem" onClick={() => { setMore(false); setDialog('edit') }}>{t('patientForm.edit')}</button>
                  <button role="menuitem" onClick={() => { setMore(false); setDialog('plan') }}>{t('plan.new')}</button>
                  <button role="menuitem" onClick={() => { setMore(false); setDialog('archive') }}>{t('archive.action')}</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <dl className="patient-facts">
          <div><dt>{t('patientForm.doctor')}</dt><dd>{doctorName ?? t('common.none')}</dd></div>
          <div><dt>{t('patients.col.lastVisit')}</dt><dd>{lastVisit.data ? date(lastVisit.data) : t('patients.newPatient')}</dd></div>
          <div><dt>{t('patient.nextVisit')}</dt><dd>{nextAppointment ? `${date(nextAppointment.starts_at)} ${time(nextAppointment.starts_at)}` : t('common.none')}</dd></div>
          <div className={owed > 0 ? '' : 'is-muted'}><dt>{t('patients.col.owed')}</dt><dd className={overdue > 0 ? 'danger-text' : ''}>{owed > 0 ? money(owed) : t('common.none')}</dd></div>
          <div><dt>{t('patient.cameFrom')}</dt><dd>{patient.source ? t(`source.${patient.source}` as Parameters<typeof t>[0]) : t('patientForm.sourceUnknown')}</dd></div>
        </dl>

        <div className="patient-chips">
          {patient.archived_at && <span className="badge badge-muted">{t('archive.banner')}{patient.archive_reason ? ` · ${patient.archive_reason}` : ''}</span>}
          {(patient.medical_alerts ?? '').split(/[،,\n]+/).map((a) => a.trim()).filter(Boolean).map((a, i) => (
            <span key={i} className={i === 0 ? 'pill pill-danger' : 'pill'}>{a}</span>
          ))}
          {(patient.allergy_groups ?? []).length > 0 && <span className="pill pill-danger">{t('patient.allergyGroups', { n: (patient.allergy_groups ?? []).length })}</span>}
          {plans.some((p) => p.consent_signed) && <span className="pill">{t('patient.contractSigned')}</span>}
          {(xrays.data ?? 0) > 0 && <span className="pill">{t('patient.xrays', { n: xrays.data ?? 0 })}</span>}
          {recallOverdue && !inTreatment && <span className="pill">{t('patient.recallDueChip')}</span>}
        </div>
      </section>

      <nav className="tabs2" role="tablist">
        {(['overview', 'treatment', 'account', 'files', 'rx'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t(`tab.${k}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </nav>

      <div className="patient-grid">
        {tab === 'overview' && (
          <>
            <div className="panel-wide"><ToothHistory patientId={id} onAddForTooth={(tooth) => {
              const active = plans.find((p) => p.status === 'active' || p.status === 'draft' || p.status === 'presented')
              if (active?.treatment_plan_id) navigate(`/plans/${active.treatment_plan_id}?tooth=${tooth}`)
              else { setPlanTooth(tooth); setDialog('plan') }
            }} /></div>
            <div className="panel-wide split-2">
              <CurrentPlanCard plans={plans} />
              <AccountCard balances={balances} perSession={perSession} onPay={() => setTab('account')}
                nextInstallment={(ledger.data?.installments ?? []).filter((r) => (r.remaining ?? 0) > 0 && r.due_date)
                  .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))[0] ?? null} />
            </div>
          </>
        )}

        {tab === 'treatment' && (
          <>
            <PatientAppointments patient={{
              id: patient.id, full_name: patient.full_name, phone: patient.phone, medical_alerts: patient.medical_alerts,
            }} />

            <PatientNotes patientId={id} initial={patient.notes} />

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

        {tab === 'rx' && (
          <section className="panel panel-wide"><PatientAllergies patientId={patient.id} groups={patient.allergy_groups ?? []} /></section>
        )}
        {tab === 'rx' && (
          <PatientPrescriptions patient={{
            id: patient.id, full_name: patient.full_name, medical_alerts: patient.medical_alerts,
            allergy_groups: patient.allergy_groups ?? [],
          }} />
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

      {dialog === 'archive' && (
        <PatientDangerZone patientId={id} archived={!!patient.archived_at} onClose={() => setDialog(null)} />
      )}
      {dialog === 'edit' && (
        <PatientForm onClose={() => setDialog(null)} patient={{
          id: patient.id, full_name: patient.full_name, phone: patient.phone, whatsapp_phone: patient.whatsapp_phone,
          gender: patient.gender, date_of_birth: patient.date_of_birth, medical_alerts: patient.medical_alerts,
          source: patient.source, source_note: patient.source_note, payer_id: patient.payer_id,
          primary_doctor_id: patient.primary_doctor_id,
          recall_interval_months: patient.recall_interval_months,
          national_id: patient.national_id, address: patient.address,
        }} />
      )}
      {dialog === 'plan' && <NewPlanDialog patientId={id} tooth={planTooth} onClose={() => { setDialog(null); setPlanTooth(null) }} />}
      {(dialog === 'visit' || dialog === 'dictate') && (
        <SessionDialog patientId={id} plan={null} dictate={dialog === 'dictate'} onClose={() => setDialog(null)} />
      )}
      {dialog === 'book' && (
        <AppointmentDialog onClose={() => setDialog(null)} initial={{
          patient: { id: patient.id, full_name: patient.full_name, phone: patient.phone, medical_alerts: patient.medical_alerts },
        }} />
      )}
    </section>
  )
}
