import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import type { PlanSummary } from '../patients/api'
import type { InstallmentRow, Payment } from './api'
import { RecordPaymentDialog } from './RecordPaymentDialog'
import { ReversePaymentDialog } from './ReversePaymentDialog'
import { installmentStatusKey, installmentTone, methodKey } from './labels'

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
  const { isDoctor } = useAuth()
  const [paying, setPaying] = useState(false)
  const [reversing, setReversing] = useState<Payment | null>(null)

  const outstanding = summary.outstanding ?? 0
  const reversedIds = new Set(payments.map((p) => p.reverses_payment_id).filter(Boolean))
  const visibleSchedule = schedule.filter((r) => r.status !== 'cancelled')

  return (
    <article className={`plan-card ${summary.sessions_locked ? 'is-locked' : ''}`}>
      <header className="plan-card-head">
        <h3>{planTitle}</h3>
        {outstanding > 0 && (
          <button className="btn btn-primary" onClick={() => setPaying(true)}>{t('pay.open')}</button>
        )}
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
          <ul className="payment-list">
            {payments.map((p) => {
              const isReversal = p.amount < 0
              const wasReversed = reversedIds.has(p.id)
              return (
                <li key={p.id} className={isReversal || wasReversed ? 'is-void' : ''}>
                  <div className="payment-main">
                    <span className="payment-amount">{money(p.amount)}</span>
                    <span>{t(methodKey(p.method))}</span>
                    <span className="muted">{date(p.received_at)}</span>
                  </div>
                  <div className="payment-sub">
                    <span className="muted">
                      {t('payments.receipt', { n: p.receipt_no })}
                      {p.received_by && staffNames.get(p.received_by) ? ` — ${staffNames.get(p.received_by)}` : ''}
                    </span>
                    {isReversal && <span className="badge badge-muted">{t('payments.reversal')}</span>}
                    {wasReversed && <span className="badge badge-muted">{t('payments.reversed')}</span>}
                    {p.note && <span className="muted">{p.note}</span>}
                    <span className="payment-actions">
                      <Link to={`/receipts/${p.id}`} target="_blank" rel="noreferrer">{t('payments.print')}</Link>
                      {isDoctor && !isReversal && !wasReversed && (
                        <button className="link-btn danger-link" onClick={() => setReversing(p)}>
                          {t('payments.reverse')}
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
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
      {reversing && <ReversePaymentDialog payment={reversing} onClose={() => setReversing(null)} />}
    </article>
  )
}
