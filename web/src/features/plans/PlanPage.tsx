import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { Modal } from '../../components/Modal'
import { PlanStatusBadge } from '../../components/PlanStatusBadge'
import { SessionDialog } from '../sessions/SessionDialog'
import { DirectPaymentDialog } from '../payments/DirectPaymentDialog'
import { PaymentList } from '../payments/PaymentList'
import { AddItemsForm } from './AddItemsForm'
import { InstallmentSetupDialog } from './InstallmentSetupDialog'
import { cancelInstallmentPlan, cancelItem, getPlan, setDiscount, setStatus, type PlanItem, type PlanStatus } from './api'

type Dialog = 'installments' | 'revise' | 'decline' | 'cancelInstallments' | 'session' | 'pay' | null

export function PlanPage() {
  const { planId = '' } = useParams()
  const { t, money, date } = useI18n()
  const { isDoctor } = useAuth()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [reason, setReason] = useState('')

  const q = useQuery({ queryKey: ['plan', planId], queryFn: () => getPlan(planId), enabled: !!planId })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['plan', planId] })
    if (q.data) {
      queryClient.invalidateQueries({ queryKey: ['patient', q.data.plan.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['ledger', q.data.plan.patient_id] })
    }
    queryClient.invalidateQueries({ queryKey: ['patients'] })
  }

  const status = useMutation({
    mutationFn: (args: { to: PlanStatus; reason?: string }) => setStatus(planId, args.to, args.reason),
    onSuccess: () => { setDialog(null); setReason(''); refresh() },
  })
  const removeItem = useMutation({ mutationFn: cancelItem, onSuccess: refresh })
  const discount = useMutation({ mutationFn: (v: number) => setDiscount(planId, v), onSuccess: refresh })
  const stopInstallments = useMutation({
    mutationFn: (id: string) => cancelInstallmentPlan(id, reason),
    onSuccess: () => { setDialog(null); setReason(''); refresh() },
  })

  if (q.isPending) return <section className="page"><Skeleton rows={4} variant="list" /></section>
  if (q.isError) return <section className="page"><ErrorNote error={q.error} onRetry={() => q.refetch()} /></section>
  if (!q.data) return <section className="page"><p className="empty">{t('plan.notFound')}</p></section>

  const { plan, items, patient, installments, procedures, sessions, directPayments, staffNames } = q.data
  const st = plan.status as PlanStatus
  const live = items.filter((i) => i.status !== 'cancelled')
  const subtotal = live.reduce((s, i) => s + i.price, 0)
  const net = subtotal - plan.discount
  const editable = st === 'draft' || st === 'presented' || st === 'active'
  const procName = new Map(procedures.map((p) => [p.id, p.name]))
  const itemLabel = (i: PlanItem) =>
    [i.procedure_id ? procName.get(i.procedure_id) : null, i.description, i.tooth_number ? t('plan.tooth', { n: i.tooth_number }) : null]
      .filter(Boolean).join(' — ')
  const openItems = live.filter((i) => i.status === 'planned')
  const directPaid = directPayments.reduce((sum, p) => sum + p.amount, 0)
  const directRemaining = Math.max(0, Math.round((net - directPaid) * 100) / 100)
  const needsRevision = !!installments && Math.abs((installments.net_total ?? 0) - net) > 0.001

  return (
    <section className="page plan">
      <Link to={`/patients/${plan.patient_id}`} className="back-link">{patient?.full_name}</Link>

      <header className="page-head">
        <div className="title-block">
          <h1>{plan.title}</h1>
          <PlanStatusBadge status={st} />
        </div>
        <div className="head-actions">
          {st === 'draft' && live.length > 0 && (
            <button className="btn" onClick={() => status.mutate({ to: 'presented' })}>{t('plan.present')}</button>
          )}
          {(st === 'draft' || st === 'presented') && live.length > 0 && (
            <>
              {isDoctor && (
                <button className="btn btn-primary" onClick={() => setDialog('installments')}>{t('plan.acceptInstallments')}</button>
              )}
              <button className="btn" onClick={() => status.mutate({ to: 'active' })}>{t('plan.acceptNoInstallments')}</button>
            </>
          )}
          {st === 'presented' && <button className="btn" onClick={() => setDialog('decline')}>{t('plan.decline')}</button>}
          {st === 'declined' && <button className="btn" onClick={() => status.mutate({ to: 'presented' })}>{t('plan.presentAgain')}</button>}
          {st === 'active' && (
            <button className="btn btn-primary" onClick={() => setDialog('session')}>{t('plan.recordSession')}</button>
          )}
          {st === 'active' && openItems.length === 0 && live.length > 0 && (
            <button className="btn" onClick={() => status.mutate({ to: 'completed' })}>{t('plan.complete')}</button>
          )}
        </div>
      </header>

      {patient?.medical_alerts && (
        <div className="medical-alert" role="note">
          <strong>{t('patient.alertTitle')}</strong>
          <p>{patient.medical_alerts}</p>
        </div>
      )}

      {plan.decline_reason && st === 'declined' && (
        <p className="muted">{t('plan.declinedBecause', { reason: plan.decline_reason })}</p>
      )}
      {status.isError && <ErrorNote error={status.error} />}

      <section className="panel">
        <h2>{t('plan.items')}</h2>
        {live.length === 0 && <p className="muted">{t('plan.noItems')}</p>}
        {live.length > 0 && (
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>{t('plan.col.item')}</th>
                  <th>{t('plan.col.tooth')}</th>
                  <th className="num">{t('plan.col.price')}</th>
                  <th>{t('plan.col.status')}</th>
                  {editable && <th aria-label={t('plan.remove')} />}
                </tr>
              </thead>
              <tbody>
                {live.map((i) => (
                  <tr key={i.id}>
                    <td>{(i.procedure_id && procName.get(i.procedure_id)) || i.description}
                      {i.procedure_id && i.description && <span className="muted"> — {i.description}</span>}</td>
                    <td>{i.tooth_number ?? t('common.none')}</td>
                    <td className="num">{money(i.price)}</td>
                    <td>{i.status === 'done'
                      ? <span className="badge badge-ok">{t('plan.itemDone')}</span>
                      : <span className="badge badge-neutral">{t('plan.itemPlanned')}</span>}</td>
                    {editable && (
                      <td className="num">
                        {i.status === 'planned' && (
                          <button className="link-btn danger-link" disabled={removeItem.isPending}
                            onClick={() => removeItem.mutate(i.id)}>{t('plan.remove')}</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {removeItem.isError && <ErrorNote error={removeItem.error} />}

        <dl className="totals">
          <div><dt>{t('plan.subtotal')}</dt><dd>{money(subtotal)}</dd></div>
          <div>
            <dt>{t('plan.discount')}</dt>
            <dd>
              {editable && !installments ? (
                <input key={plan.discount} type="number" min="0" step="1" dir="ltr" className="inline-number"
                  defaultValue={plan.discount}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v) && v >= 0 && v !== plan.discount) discount.mutate(v)
                  }} />
              ) : money(plan.discount)}
            </dd>
          </div>
          <div className="totals-net"><dt>{t('plan.net')}</dt><dd>{money(net)}</dd></div>
        </dl>
        {discount.isError && <ErrorNote error={discount.error} />}

        {editable && (
          <AddItemsForm
            planId={planId}
            procedures={procedures}
            markedTeeth={new Set(live.map((i) => i.tooth_number).filter((n): n is number => n != null))}
          />
        )}
      </section>

      <section className="panel">
        <h2>{t('patient.balance')}</h2>
        {!installments && (
          <>
            <p className="muted">{t('plan.noInstallments')}</p>
            {(st === 'active' || st === 'completed') && (
              <>
                <dl className="figures">
                  <div><dt>{t('plan.net')}</dt><dd>{money(net)}</dd></div>
                  <div><dt>{t('patient.paid')}</dt><dd>{money(directPaid)}</dd></div>
                  <div><dt>{t('patient.outstanding')}</dt><dd>{money(directRemaining)}</dd></div>
                </dl>
                {directRemaining > 0 && (
                  <div><button className="btn btn-primary" onClick={() => setDialog('pay')}>{t('pay.open')}</button></div>
                )}
              </>
            )}
            {directPayments.length > 0 && <PaymentList payments={directPayments} staffNames={staffNames} />}
          </>
        )}
        {installments && (
          <>
            <dl className="figures">
              <div><dt>{t('patient.outstanding')}</dt><dd>{money(installments.outstanding)}</dd></div>
              <div><dt>{t('patient.paid')}</dt><dd>{money(installments.total_paid)}</dd></div>
              <div className={(installments.overdue_amount ?? 0) > 0 ? 'is-overdue' : ''}>
                <dt>{t('patient.overdueAmount')}</dt><dd>{money(installments.overdue_amount)}</dd>
              </div>
              <div><dt>{t('patient.nextDue')}</dt><dd>{date(installments.next_due_date)}</dd></div>
            </dl>
            {needsRevision && (
              <div className="lock-note">
                <p>{t('plan.needsRevision', { was: money(installments.net_total), now: money(net) })}</p>
                {isDoctor
                  ? <button className="btn" onClick={() => setDialog('revise')}>{t('inst.reviseTitle')}</button>
                  : <p>{t('plan.askDoctor')}</p>}
              </div>
            )}
            <div className="row-actions">
              <Link to={`/patients/${plan.patient_id}`}>{t('plan.goToPayments')}</Link>
              {isDoctor && (
                <button className="link-btn danger-link" onClick={() => setDialog('cancelInstallments')}>
                  {t('plan.cancelInstallments')}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>{t('plan.sessions')}</h2>
        {sessions.length === 0 && <p className="muted">{t('plan.noSessions')}</p>}
        <ul className="plan-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <div className="plan-line">
                <span>{date(s.performed_at)}</span>
                {s.lock_override && <span className="badge badge-warn">{t('plan.overridden')}</span>}
              </div>
              {s.notes && <p className="plan-sub">{s.notes}</p>}
              {s.lock_override && s.override_reason && <p className="plan-sub muted">{s.override_reason}</p>}
            </li>
          ))}
        </ul>
      </section>

      {dialog === 'installments' && (
        <InstallmentSetupDialog planId={planId} patientId={plan.patient_id} netTotal={net} onClose={() => setDialog(null)} />
      )}
      {dialog === 'revise' && installments?.installment_plan_id && (
        <InstallmentSetupDialog planId={planId} patientId={plan.patient_id} netTotal={net}
          revise={{ installmentPlanId: installments.installment_plan_id, alreadyPaid: installments.total_paid ?? 0 }}
          onClose={() => setDialog(null)} />
      )}
      {dialog === 'session' && (
        <SessionDialog patientId={plan.patient_id}
          plan={{ id: planId, title: plan.title, openItems: openItems.map((i) => ({ id: i.id, label: itemLabel(i) })) }}
          onClose={() => setDialog(null)} />
      )}
      {dialog === 'pay' && (
        <DirectPaymentDialog patientId={plan.patient_id} planId={planId} planTitle={plan.title}
          remaining={directRemaining} onClose={() => setDialog(null)} />
      )}
      {dialog === 'decline' && (
        <Modal title={t('plan.decline')} onClose={() => setDialog(null)}>
          <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); status.mutate({ to: 'declined', reason }) }}>
            <label className="field">
              <span>{t('plan.declineReason')}</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('plan.declineHint')} maxLength={200} />
            </label>
            <div className="dialog-actions">
              <button type="submit" className="btn btn-primary" disabled={status.isPending}>{t('plan.decline')}</button>
              <button type="button" className="btn" onClick={() => setDialog(null)}>{t('common.cancel')}</button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'cancelInstallments' && installments?.installment_plan_id && (
        <Modal title={t('plan.cancelInstallments')} onClose={() => setDialog(null)}>
          <form className="dialog-form" onSubmit={(e) => {
            e.preventDefault()
            if (reason.trim()) stopInstallments.mutate(installments.installment_plan_id!)
          }}>
            <p>{t('plan.cancelInstallmentsExplain')}</p>
            <label className="field">
              <span>{t('reverse.reason')}</span>
              <input required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
            </label>
            {stopInstallments.isError && <ErrorNote error={stopInstallments.error} />}
            <div className="dialog-actions">
              <button type="submit" className="btn btn-danger" disabled={!reason.trim() || stopInstallments.isPending}>
                {t('plan.cancelInstallments')}
              </button>
              <button type="button" className="btn" onClick={() => setDialog(null)}>{t('common.cancel')}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
