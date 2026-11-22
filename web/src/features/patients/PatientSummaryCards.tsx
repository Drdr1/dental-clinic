import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { Skeleton } from '../../components/Skeleton'
import { getPlan } from '../plans/api'
import type { PlanBalance, PlanOverview, PlanSummary } from './api'

/** The plan being worked on now: its items, tooth by tooth, and how far along it is. */
export function CurrentPlanCard({ plans }: { plans: PlanOverview[] }) {
  const { t, money } = useI18n()
  const current = plans.find((p) => p.status === 'active')
    ?? plans.find((p) => p.status === 'presented' || p.status === 'draft')
  const q = useQuery({
    queryKey: ['plan', current?.treatment_plan_id],
    queryFn: () => getPlan(current!.treatment_plan_id!),
    enabled: !!current?.treatment_plan_id,
  })
  if (!current) return null
  const items = (q.data?.items ?? []).filter((i) => i.status !== 'cancelled')
  const names = new Map((q.data?.procedures ?? []).map((p) => [p.id, p.name]))
  const done = items.filter((i) => i.status === 'done').length

  return (
    <section className="panel">
      <div className="panel-head">
        <h2><Link to={`/plans/${current.treatment_plan_id}`} className="row-link">{current.title}</Link></h2>
        {items.length > 0 && <span className="muted small">{t('patient.itemsDone', { done, n: items.length })}</span>}
      </div>
      {q.isPending && <Skeleton rows={3} />}
      {items.length > 0 && (
        <div className="table-scroll">
          <table className="table table-plain">
            <thead><tr>
              <th>{t('appt.col.plan')}</th><th>{t('patient.col.tooth')}</th>
              <th>{t('patient.col.price')}</th><th>{t('inst.col.status')}</th>
            </tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{(i.procedure_id && names.get(i.procedure_id)) || i.description || '—'}</td>
                  <td>{i.tooth_number ?? '—'}</td>
                  <td className="nowrap">{money(i.price)}</td>
                  <td>
                    <span className={`badge ${i.status === 'done' ? 'badge-neutral' : 'badge-muted'}`}>
                      {i.status === 'done' ? t('plan.itemDone') : t('plan.itemPlanned')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && items.length === 0 && <p className="muted">{t('patient.planNoItems')}</p>}
    </section>
  )
}

/** Money at a glance: what is left, what was paid, and when the next installment falls due. */
export function AccountCard({ balances, perSession, onPay }: {
  balances: PlanSummary[]; perSession: PlanBalance[]; onPay: () => void
}) {
  const { t, money, date } = useI18n()
  const owed = balances.reduce((s, b) => s + (b.outstanding ?? 0), 0) + perSession.reduce((s, b) => s + (b.outstanding ?? 0), 0)
  const paid = balances.reduce((s, b) => s + (b.total_paid ?? 0), 0) + perSession.reduce((s, b) => s + (b.paid ?? 0), 0)
  const total = owed + paid
  const nextDue = balances.map((b) => b.next_due_date).filter((d): d is string => !!d).sort()[0]
  const overdue = balances.reduce((s, b) => s + (b.overdue_amount ?? 0), 0)

  return (
    <section className="panel account-card">
      <h2>{t('patient.balance')}</h2>
      {total === 0 ? <p className="muted">{t('patient.balanceEmpty')}</p> : (
        <>
          <div className="account-left">
            <span className="muted">{t('patient.remaining')}</span>
            <strong className={overdue > 0 ? 'danger-text' : ''}>{money(owed)}</strong>
          </div>
          <div className="kpi-bar"><span style={{ width: `${total ? (paid / total) * 100 : 0}%` }} /></div>
          <div className="account-split muted small">
            <span>{t('patient.paidAmount', { amount: money(paid) })}</span>
            <span>{t('patient.totalAmount', { amount: money(total) })}</span>
          </div>
          {overdue > 0 && <p className="alert-strip">{t('patient.overdueLine', { amount: money(overdue) })}</p>}
          {nextDue && (
            <div className="next-due">
              <span>{t('patient.nextInstallment')}</span>
              <strong>{date(nextDue)}</strong>
            </div>
          )}
        </>
      )}
      <button className="btn btn-ink" onClick={onPay}>{t('patient.recordPayment')}</button>
    </section>
  )
}
