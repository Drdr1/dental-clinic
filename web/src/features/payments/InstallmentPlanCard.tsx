import { useState } from 'react'
import { useI18n } from '../../i18n'
import type { PlanSummary } from '../patients/api'
import type { InstallmentRow, Payment } from './api'
import { RecordPaymentDialog } from './RecordPaymentDialog'
import { PaymentList } from './PaymentList'
import { installmentStatusKey, installmentTone } from './labels'

type Props = {
  summary: PlanSummary
  planTitle: string
  patientId: string
  schedule: InstallmentRow[]
  payments: Payment[]
  staffNames: Map<string, string>
}

export function InstallmentPlanCard({ summary, planTitle, patientId, schedule, payments, staffNames }: Props) {
  const { t, money, date } = useI18n()
  const [paying, setPaying] = useState(false)

  const outstanding = summary.outstanding ?? 0
  const visibleSchedule = schedule.filter((r) => r.status !== 'cancelled')

  return (
    <article className={`plan-card ${summary.sessions_locked ? 'is-locked' : ''}`}>
      <header className="plan-card-head">
        <h3>{planTitle}</h3>
        <span className="head-actions">
          {summary.installment_plan_id && (
            <a className="btn" href={`/agreements/${summary.installment_plan_id}`} target="_blank" rel="noreferrer">{t('agr.open')}</a>
          )}
          {outstanding > 0 && (
            <button className="btn btn-primary" onClick={() => setPaying(true)}>{t('pay.open')}</button>
          )}
        </span>
      </header>

      <dl className="figures">
        <div><dt>{t('patient.outstanding')}</dt><dd>{money(outstanding)}</dd></div>
        <div><dt>{t('patient.paid')}</dt><dd>{money(summary.total_paid)}</dd></div>
        <div className={(summary.overdue_amount ?? 0) > 0 ? 'is-overdue' : ''}>
          <dt>{t('patient.overdueAmount')}</dt><dd>{money(summary.overdue_amount)}</dd>
        </div>
        <div><dt>{t('patient.nextDue')}</dt><dd>{date(summary.next_due_date)}</dd></div>
      </dl>

      {summary.sessions_locked && <p className="lock-note">{t('patient.locked')}</p>}

      <details className="disclosure" open={(summary.overdue_count ?? 0) > 0}>
        <summary>{t('inst.schedule', { n: visibleSchedule.length })}</summary>
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>{t('inst.col.item')}</th>
                <th>{t('inst.col.due')}</th>
                <th className="num">{t('inst.col.amount')}</th>
                <th className="num">{t('inst.col.remaining')}</th>
                <th>{t('inst.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleSchedule.map((r) => (
                <tr key={r.id}>
                  <td>{r.is_down_payment ? t('inst.downPayment') : t('inst.number', { n: r.seq ?? 0 })}</td>
                  <td>{date(r.due_date)}</td>
                  <td className="num">{money(r.amount)}</td>
                  <td className="num">{(r.remaining ?? 0) > 0 ? money(r.remaining) : t('common.none')}</td>
                  <td>
                    <span className={`badge badge-${installmentTone[r.status ?? 'upcoming']}`}>
                      {t(installmentStatusKey(r.status))}
                    </span>
                    {r.is_partial && <span className="partial-note">{t('inst.partial')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {payments.length > 0 && (
        <details className="disclosure">
          <summary>{t('payments.title', { n: payments.length })}</summary>
          <PaymentList payments={payments} staffNames={staffNames} />
        </details>
      )}

      {paying && summary.installment_plan_id && (
        <RecordPaymentDialog
          planId={summary.installment_plan_id}
          planTitle={planTitle}
          patientId={patientId}
          outstanding={outstanding}
          schedule={schedule}
          onClose={() => setPaying(false)}
        />
      )}
    </article>
  )
}
