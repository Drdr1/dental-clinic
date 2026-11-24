import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { Skeleton } from '../../components/Skeleton'
import { getPlan } from '../plans/api'
import { supabase } from '../../lib/supabase'
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
  const labs = useQuery({
    queryKey: ['plan-labs', current?.treatment_plan_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('lab_case_status').select('plan_item_id, received_on, cancelled_at')
        .eq('patient_id', current!.patient_id!)
      if (error) throw error
      return new Set(data.filter((l) => !l.received_on && !l.cancelled_at && l.plan_item_id).map((l) => l.plan_item_id as string))
    },
    enabled: !!current?.patient_id,
  })
  // After every hook: a patient's first plan appearing must not change how many hooks run.
  if (!current) return null
  const items = (q.data?.items ?? []).filter((i) => i.status !== 'cancelled')
  // A tooth with sessions already done on its plan but this item still open is being worked on.
  const started = (q.data?.sessions ?? []).length > 0
  const names = new Map((q.data?.procedures ?? []).map((p) => [p.id, p.name]))
  const done = items.filter((i) => i.status === 'done').length

  return (
    <section className="panel">
      <div className="panel-head">
        <h2><Link to={`/plans/${current.treatment_plan_id}`} className="row-link">{t('patient.currentPlan')}</Link></h2>
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
                    {i.status === 'done' ? <span className="badge badge-neutral">{t('patient.st.done')}</span>
                      : labs.data?.has(i.id) ? <span className="badge badge-info">{t('patient.st.lab')}</span>
                      : started && current.status === 'active' ? <span className="badge badge-info">{t('patient.st.ongoing')}</span>
                      : <span className="badge badge-muted">{t('patient.st.notYet')}</span>}
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
export function AccountCard({ balances, perSession, onPay, nextInstallment }: {
  balances: PlanSummary[]; perSession: PlanBalance[]; onPay: () => void
  nextInstallment: { remaining: number | null; due_date: string | null } | null
}) {
  const { t, money, date } = useI18n()
  // Owed: the schedules' remainder plus done work not yet paid for. Work still
  // to come on a pay-per-session plan is not a debt yet; it shows on its own line.
  const owed = balances.reduce((s, b) => s + (b.outstanding ?? 0), 0) + perSession.reduce((s, b) => s + (b.outstanding ?? 0), 0)
  const upcomingWork = perSession.reduce((s, b) => s + Math.max(0, (b.plan_remaining ?? 0) - (b.outstanding ?? 0)), 0)
  const paid = balances.reduce((s, b) => s + (b.total_paid ?? 0), 0) + perSession.reduce((s, b) => s + (b.paid ?? 0), 0)
  const total = owed + upcomingWork + paid
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
          {upcomingWork > 0 && <p className="muted small">{t('patient.upcomingWork', { amount: money(upcomingWork) })}</p>}
          {overdue > 0 && <p className="alert-strip">{t('patient.overdueLine', { amount: money(overdue) })}</p>}
          {nextInstallment?.due_date && (
            <div className="next-due">
              <span>{t('patient.nextInstallment')}</span>
              <strong>{money(nextInstallment.remaining)} · {date(nextInstallment.due_date)}</strong>
            </div>
          )}
        </>
      )}
      <button className="btn btn-ink" onClick={onPay}>{t('patient.recordPayment')}</button>
    </section>
  )
}
