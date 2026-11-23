import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, useFeature } from '../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { whatsappLink } from '../../lib/phone'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { Modal } from '../../components/Modal'
import { PlanStatusBadge } from '../../components/PlanStatusBadge'
import { SessionDialog } from '../sessions/SessionDialog'
import { DirectPaymentDialog } from '../payments/DirectPaymentDialog'
import { PaymentList } from '../payments/PaymentList'
import { Icon } from '../../components/Icon'
import { AddItemsForm } from './AddItemsForm'
import { DictatePlanDialog } from '../dictation/DictatePlanDialog'
import { InstallmentSetupDialog } from './InstallmentSetupDialog'
import { cancelInstallmentPlan, cancelItem, cancelPlan, deletePlan, getPlan, setDiscount, setStatus, type PlanItem, type PlanStatus } from './api'

type Dialog = 'installments' | 'revise' | 'decline' | 'cancelInstallments' | 'cancelPlan' | 'session' | 'pay' | 'dictate' | null

// Keyed by plan: moving from one plan to another starts with a clean form.
export function PlanPage() {
  const { planId = '' } = useParams()
  return <PlanView key={planId} />
}

function PlanView() {
  const { planId = '' } = useParams()
  const { t, money, day } = useI18n()
  const hasInstallments = useFeature('installments')
  const { isDoctor } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [reason, setReason] = useState('')
  // Coming from a tooth in the patient file (?tooth=15): open the form with that tooth picked.
  const [params, setParams] = useSearchParams()
  const fromTooth = Number(params.get('tooth'))
  const [startTeeth] = useState<number[]>(() => (fromTooth >= 11 && fromTooth <= 48 ? [fromTooth] : []))
  const [adding, setAdding] = useState(startTeeth.length > 0)
  useEffect(() => {
    if (params.has('tooth')) setParams((p) => { p.delete('tooth'); return p }, { replace: true })
  }, [params, setParams])
  const [more, setMore] = useState(false)
  const [allInstallments, setAllInstallments] = useState(false)
  useEffect(() => {
    if (!more) return
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest('.user-menu')) setMore(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [more])

  const q = useQuery({ queryKey: ['plan', planId], queryFn: () => getPlan(planId), enabled: !!planId })
  // The schedule row by row, and what the lab has of this plan's items.
  const extra = useQuery({
    queryKey: ['plan-extra', planId],
    queryFn: async () => {
      const [rows, items] = await Promise.all([
        supabase.from('installment_status').select('*').eq('treatment_plan_id', planId).order('seq'),
        supabase.from('treatment_plan_items').select('id').eq('plan_id', planId),
      ])
      if (rows.error) throw rows.error
      if (items.error) throw items.error
      const ids = items.data.map((i) => i.id)
      const lab = ids.length
        ? await supabase.from('lab_case_status').select('plan_item_id, lab_name, shade, received_on, cancelled_at').in('plan_item_id', ids)
        : { data: [], error: null }
      if (lab.error) throw lab.error
      return { schedule: rows.data ?? [], labs: lab.data ?? [] }
    },
    enabled: !!planId,
  })

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
  const discount = useMutation({
    mutationFn: (a: { value: number; payer?: { id: string; percent: number } | null }) => setDiscount(planId, a.value, a.payer),
    onSuccess: refresh,
  })
  const stopInstallments = useMutation({
    mutationFn: (id: string) => cancelInstallmentPlan(id, reason),
    onSuccess: () => { setDialog(null); setReason(''); refresh() },
  })
  const scrapPlan = useMutation({
    mutationFn: (mode: 'cancel' | 'delete') =>
      mode === 'cancel' ? cancelPlan(planId, reason) : deletePlan(planId),
    onSuccess: (_d, mode) => {
      setDialog(null); setReason(''); refresh()
      if (mode === 'delete' && q.data) navigate(`/patients/${q.data.plan.patient_id}`)
    },
  })

  if (q.isPending) return <section className="page"><Skeleton rows={4} variant="list" /></section>
  if (q.isError) return <section className="page"><ErrorNote error={q.error} onRetry={() => q.refetch()} /></section>
  if (!q.data) return <section className="page"><p className="empty">{t('plan.notFound')}</p></section>

  const { plan, items, patient, installments, procedures, sessions, planPayments, staffNames } = q.data
  // With a live schedule the schedule card lists its own payments, so only
  // the pay-per-session ones belong here. Without one — including a schedule
  // that was cancelled — every payment on the plan belongs here, or money
  // taken against the old schedule would be invisible and unreversible.
  const directPayments = installments ? planPayments.filter((p) => !p.installment_plan_id) : planPayments
  const st = plan.status as PlanStatus
  const live = items.filter((i) => i.status !== 'cancelled')
  const subtotal = live.reduce((s, i) => s + i.price, 0)
  const net = subtotal - plan.discount
  const editable = st === 'draft' || st === 'presented' || st === 'active'
  const payerRaw = (patient as { payers?: unknown } | null)?.payers
  const payer = (Array.isArray(payerRaw) ? payerRaw[0] : payerRaw) as { id: string; name: string; discount_percent: number } | null | undefined
  const procName = new Map(procedures.map((p) => [p.id, p.name]))
  const itemLabel = (i: PlanItem) =>
    [i.procedure_id ? procName.get(i.procedure_id) : null, i.description, i.tooth_number ? t('plan.tooth', { n: i.tooth_number }) : null]
      .filter(Boolean).join(' — ')
  const openItems = live.filter((i) => i.status === 'planned')
  const directPaid = directPayments.reduce((sum, p) => sum + p.amount, 0)
  const directRemaining = Math.max(0, Math.round((net - directPaid) * 100) / 100)
  const needsRevision = !!installments && Math.abs((installments.net_total ?? 0) - net) > 0.001

  const steps: PlanStatus[] = ['draft', 'presented', 'active', 'active', 'completed']
  const stepIndex = st === 'completed' ? 4 : st === 'active' ? 3 : st === 'presented' ? 1 : st === 'draft' ? 0 : -1
  const lab = new Map((extra.data?.labs ?? []).filter((l) => !l.cancelled_at).map((l) => [l.plan_item_id, l]))
  const sessionNo = new Map([...sessions].sort((a, b) => a.performed_at.localeCompare(b.performed_at)).map((x, i) => [x.id, i + 1]))
  // What each session finished, grouped the way it is said: "حشو تجميلي 16 و46".
  const doneIn = new Map<string, string[]>()
  for (const sid of new Set(live.map((i) => i.done_in_session_id).filter((x): x is string => !!x))) {
    const groups = new Map<string, number[]>()
    for (const i of live.filter((x) => x.done_in_session_id === sid)) {
      const name = (i.procedure_id && procName.get(i.procedure_id)) || i.description || ''
      groups.set(name, [...(groups.get(name) ?? []), ...(i.tooth_number ? [i.tooth_number] : [])])
    }
    doneIn.set(sid, [...groups].map(([name, teeth]) => teeth.length ? `${name} ${teeth.join(' و')}` : name))
  }
  const sessionsNewest = [...sessions].sort((a, b) => b.performed_at.localeCompare(a.performed_at))
  const schedule = extra.data?.schedule ?? []
  const shownSchedule = allInstallments ? schedule : schedule.slice(0, 4)
  const lastDue = schedule[schedule.length - 1]?.due_date
  const remaining = installments ? (installments.outstanding ?? 0) : directRemaining
  const paidSoFar = installments ? (installments.total_paid ?? 0) : directPaid
  const total = remaining + paidSoFar
  const doneCount = live.filter((i) => i.status === 'done').length
  const author = plan.created_by ? staffNames.get(plan.created_by) : null
  const phone = (patient as { whatsapp_phone?: string | null; phone?: string | null } | null)
  const instStatus = (r: (typeof schedule)[number]) =>
    (r.remaining ?? 0) <= 0 ? { cls: 'badge-neutral', key: 'plan.inst.paid' }
      : r.status === 'overdue' || r.status === 'in_grace' || r.status === 'due' ? { cls: 'badge-info', key: 'plan.inst.due' }
      : { cls: 'badge-muted', key: 'plan.inst.later' }

  return (
    <section className="page plan">
      <section className="panel plan-head">
        <div className="plan-top">
          <div>
            <nav className="crumbs crumbs-u">
              <Link to="/patients">{t('patients.title')}</Link><span>/</span>
              <Link to={`/patients/${plan.patient_id}`}>{patient?.full_name}</Link>
            </nav>
            <h1>{plan.title}</h1>
            <p className="muted">
              {[author, t('plan.madeOn', { date: day(plan.created_at) }),
                plan.accepted_at ? t('plan.acceptedOn', { date: day(plan.accepted_at) }) : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="patient-actions">
            {(st === 'active' || st === 'completed') && (
              <Link className="btn" to={`/agreements/${planId}`}>{t('plan.printContract')}</Link>
            )}
            {(phone?.whatsapp_phone || phone?.phone) && (
              <a className="btn" href={whatsappLink(phone.whatsapp_phone ?? phone.phone ?? '')} target="_blank" rel="noreferrer">
                {t('plan.whatsappPatient')}
              </a>
            )}
            {st === 'draft' && live.length > 0 && (
              <button className="btn btn-primary" onClick={() => status.mutate({ to: 'presented' })}>{t('plan.present')}</button>
            )}
            {st === 'presented' && <button className="btn" onClick={() => setDialog('decline')}>{t('plan.decline')}</button>}
            {st === 'declined' && <button className="btn btn-primary" onClick={() => status.mutate({ to: 'presented' })}>{t('plan.presentAgain')}</button>}
            {st === 'active' && openItems.length === 0 && live.length > 0 && (
              <button className="btn" onClick={() => status.mutate({ to: 'completed' })}>{t('plan.complete')}</button>
            )}
            {st === 'active' && (
              <button className="btn btn-primary" onClick={() => setDialog('session')}>{t('plan.recordSession')}</button>
            )}
            {st !== 'cancelled' && (
              <div className="user-menu">
                <button className="btn icon-square" aria-label={t('nav.more')} aria-expanded={more} onClick={() => setMore((v) => !v)}>
                  <Icon name="more" />
                </button>
                {more && (
                  <div className="user-pop" role="menu">
                    {isDoctor && installments && (
                      <button role="menuitem" onClick={() => { setMore(false); setReason(''); setDialog('cancelInstallments') }}>{t('plan.cancelInstallments')}</button>
                    )}
                    <button role="menuitem" onClick={() => { setMore(false); setReason(''); setDialog('cancelPlan') }}>{t('plan.cancelPlan')}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {stepIndex >= 0 ? (
          <ol className="stepper">
            {steps.map((_, i) => (
              <li key={i} className={i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''}>
                <span>{i + 1}</span>{t(`plan.step.${i}` as Parameters<typeof t>[0])}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted"><PlanStatusBadge status={st} /> {plan.decline_reason && st === 'declined' ? t('plan.declinedBecause', { reason: plan.decline_reason }) : ''}</p>
        )}
        {patient?.medical_alerts && <p className="alert-strip">{patient.medical_alerts}</p>}
        {status.isError && <ErrorNote error={status.error} />}
      </section>

      <div className="plan-grid">
        <div className="plan-main">
          <section className="panel">
            <div className="panel-head">
              <h2>{t('plan.items')}</h2>
              {live.length > 0 && <span className="muted small">{t('patient.itemsDone', { done: doneCount, n: live.length })}</span>}
            </div>
            {live.length === 0 && <p className="muted">{t('plan.noItems')}</p>}
            {live.length > 0 && (
              <div className="table-scroll">
                <table className="table table-plain">
                  <thead>
                    <tr>
                      <th>{t('plan.col.tooth')}</th>
                      <th>{t('plan.col.item')}</th>
                      <th>{t('plan.col.price')}</th>
                      <th>{t('plan.col.status')}</th>
                      {editable && <th aria-label={t('plan.remove')} />}
                    </tr>
                  </thead>
                  <tbody>
                    {live.map((i) => {
                      const l = lab.get(i.id)
                      const atLab = l && !l.received_on
                      return (
                        <tr key={i.id} className="hover-row">
                          <td className="strong">{i.tooth_number ?? '—'}</td>
                          <td>
                            <div className="strong">{(i.procedure_id && procName.get(i.procedure_id)) || i.description}</div>
                            {(l || (i.procedure_id && i.description)) && (
                              <div className="muted small">
                                {[i.procedure_id ? i.description : null, l?.shade ? t('plan.shade', { s: l.shade }) : null, l?.lab_name].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </td>
                          <td className="nowrap">{money(i.price)}</td>
                          <td>
                            {i.status === 'done' ? <span className="badge badge-neutral">{t('plan.itemDone')}</span>
                              : atLab ? <span className="badge badge-info">{t('patient.st.lab')}</span>
                              : st === 'active' && sessions.length > 0 ? <span className="badge badge-info">{t('plan.itemOngoing')}</span>
                              : <span className="badge badge-muted">{t('plan.itemPlanned')}</span>}
                          </td>
                          {editable && (
                            <td className="num">
                              {i.status === 'planned' && (
                                <button className="link-btn danger-link row-hover-action" disabled={removeItem.isPending}
                                  onClick={() => removeItem.mutate(i.id)}>{t('plan.remove')}</button>
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {removeItem.isError && <ErrorNote error={removeItem.error} />}

            {editable && !adding && (
              <button className="add-dashed" onClick={() => setAdding(true)}>+ {t('plan.addItem')}</button>
            )}
            {editable && adding && (
              <div className="add-box">
                <div className="dictate-cta">
                  <button type="button" className="btn" onClick={() => setDialog('dictate')}>
                    <Icon name="mic" /> {t('dict.planButton')}
                  </button>
                  <button type="button" className="link-btn" onClick={() => setAdding(false)}>{t('common.close')}</button>
                </div>
                <AddItemsForm
                  planId={planId}
                  procedures={procedures}
                  markedTeeth={new Set(live.map((i) => i.tooth_number).filter((n): n is number => n != null))}
                  initialTeeth={startTeeth}
                />
              </div>
            )}

            <dl className="totals2">
              <div><dt>{t('plan.subtotal')}</dt><dd>{money(subtotal)}</dd></div>
              <div>
                <dt>{payer && plan.discount > 0 ? t('plan.discountPayer', { name: payer.name, p: payer.discount_percent }) : t('plan.discount')}</dt>
                <dd>
                  {editable && !installments && isDoctor ? (
                    <input key={plan.discount} type="number" min="0" step="1" dir="ltr" className="inline-number"
                      defaultValue={plan.discount}
                      onBlur={(e) => {
                        const v = Number(e.target.value)
                        if (Number.isFinite(v) && v >= 0 && v !== plan.discount) discount.mutate({ value: v })
                      }} />
                  ) : plan.discount > 0 ? `− ${money(plan.discount)}` : money(0)}
                </dd>
              </div>
              <div className="totals-net"><dt>{t('plan.net')}</dt><dd>{money(net)}</dd></div>
            </dl>
            {payer && editable && !installments && Math.abs(plan.discount - Math.round(subtotal * payer.discount_percent) / 100) > 0.01 && (
              <p className="payer-note">
                {t('plan.payerAvailable', { name: payer.name, percent: payer.discount_percent })}{' '}
                <button className="link-btn" disabled={discount.isPending}
                  onClick={() => discount.mutate({
                    value: Math.round(subtotal * payer.discount_percent) / 100,
                    payer: { id: payer.id, percent: payer.discount_percent },
                  })}>
                  {t('plan.applyPayer')}
                </button>
              </p>
            )}
            {discount.isError && <ErrorNote error={discount.error} />}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>{t('plan.sessions')}</h2>
              <Link to={`/patients/${plan.patient_id}`} className="link-strong">{t('plan.allSessions')}</Link>
            </div>
            {sessions.length === 0 && !plan.accepted_at && <p className="muted">{t('plan.noSessions')}</p>}
            <ul className="tooth-log">
              {sessionsNewest.map((x) => {
                const groups = doneIn.get(x.id) ?? []
                const what = groups.length === 1 ? groups[0] : ''
                const doc = staffNames.get((x as { doctor_id?: string | null }).doctor_id ?? (x as { performed_by?: string | null }).performed_by ?? '')
                return (
                  <li key={x.id}>
                    <span className="muted small nowrap">{day(x.performed_at)}</span>
                    <div>
                      <strong>{what ? t('plan.sessionWhat', { what, n: sessionNo.get(x.id) ?? 1 })
                        : [t('plan.sessionN', { n: sessionNo.get(x.id) ?? 1 }), ...groups].join(' · ')}</strong>
                      <p className="muted small">{[x.notes, doc].filter(Boolean).join(' · ')}</p>
                      {x.lock_override && <p className="warn-text small">{t('plan.overridden')}{x.override_reason ? ` · ${x.override_reason}` : ''}</p>}
                    </div>
                  </li>
                )
              })}
              {plan.accepted_at && (
                <li>
                  <span className="muted small nowrap">{day(plan.accepted_at)}</span>
                  <div>
                    <strong>{installments ? t('plan.acceptedWithDown') : t('plan.acceptedEvent')}</strong>
                    {plan.accepted_at && (st === 'active' || st === 'completed') && <p className="muted small">{t('plan.contractSignedEvent')}</p>}
                  </div>
                  {(() => {
                    const down = schedule.find((r) => r.is_down_payment)
                    return down && (down.paid ?? 0) > 0 ? <span className="muted small nowrap">{t('plan.paidAmountShort', { amount: money(down.paid) })}</span> : null
                  })()}
                </li>
              )}
            </ul>
          </section>
        </div>

        <aside className="plan-side">
          <section className="panel account-card">
            <div className="panel-head">
              <h2>{t('plan.payment')}</h2>
              {(st === 'active' || st === 'completed') && (
                <span className="badge badge-ink">{installments ? t('plan.byInstallments') : t('plan.perSession')}</span>
              )}
            </div>
            {(st === 'active' || st === 'completed' || installments) ? (
              <>
                <div className="account-left">
                  <span className="muted">{t('patient.remaining')}</span>
                  <strong>{money(remaining)}</strong>
                </div>
                <div className="kpi-bar"><span style={{ width: `${total ? (paidSoFar / total) * 100 : 0}%` }} /></div>
                <div className="account-split muted small">
                  <span>{t('patient.paidAmount', { amount: money(paidSoFar) })}</span>
                  <span>{t('patient.totalAmount', { amount: money(total) })}</span>
                </div>
                {needsRevision && installments && (
                  <div className="lock-note">
                    <p>{t('plan.needsRevision', { was: money(installments.net_total), now: money(net) })}</p>
                    {isDoctor
                      ? <button className="btn" onClick={() => setDialog('revise')}>{t('inst.reviseTitle')}</button>
                      : <p>{t('plan.askDoctor')}</p>}
                  </div>
                )}
                {installments && schedule.length > 0 && (
                  <ul className="sched-list">
                    {shownSchedule.map((r) => {
                      const b = instStatus(r)
                      return (
                        <li key={r.id ?? `${r.seq}`}>
                          <div>
                            <strong>{r.is_down_payment ? t('inst.downPayment') : t('inst.number', { n: r.seq ?? 0 })}</strong>
                            <p className="muted small">{day(r.due_date)}</p>
                          </div>
                          <div className="sched-amt">
                            <span>{money(r.amount)}</span>
                            <span className={`badge ${b.cls}`}>{t(b.key as Parameters<typeof t>[0])}</span>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {installments && schedule.length > 4 && (
                  <button className="link-btn small" onClick={() => setAllInstallments((v) => !v)}>
                    {allInstallments ? t('plan.showLess') : t('plan.moreInstallments', { n: schedule.length - 4, date: lastDue ? new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'long' }).format(new Date(`${lastDue}T12:00:00`)) : '' })}
                  </button>
                )}
                {!installments && directPayments.length > 0 && <PaymentList payments={directPayments} staffNames={staffNames} />}
                {installments
                  ? <Link className="btn btn-ink btn-block" to={`/patients/${plan.patient_id}?tab=account`}>{t('patient.recordPayment')}</Link>
                  : directRemaining > 0 && <button className="btn btn-ink btn-block" onClick={() => setDialog('pay')}>{t('patient.recordPayment')}</button>}
              </>
            ) : <p className="muted">{t('plan.payAfterAccept')}</p>}
          </section>

          {(st === 'draft' || st === 'presented' || st === 'active' || st === 'completed') && (
            <section className="panel">
              <h2>{t('plan.payMethodTitle')}</h2>
              <div className="pay-options">
                {(hasInstallments || installments) && (
                <button type="button" className={`pay-opt${installments ? ' on' : ''}`}
                  disabled={!(st === 'draft' || st === 'presented') || live.length === 0}
                  onClick={() => setDialog('installments')}>
                  <strong>{t('plan.byInstallments')}</strong>
                  <span>{t('plan.byInstallmentsHint')}</span>
                </button>
                )}
                <button type="button" className={`pay-opt${(st === 'active' || st === 'completed') && !installments ? ' on' : ''}`}
                  disabled={!(st === 'draft' || st === 'presented') || live.length === 0}
                  onClick={() => status.mutate({ to: 'active' })}>
                  <strong>{t('plan.perSession')}</strong>
                  <span>{t('plan.perSessionHint')}</span>
                </button>
              </div>
              {(st === 'draft' || st === 'presented') && live.length > 0 && <p className="muted small">{t('plan.payMethodPick')}</p>}
            </section>
          )}
        </aside>
      </div>

      {dialog === 'installments' && (
        <InstallmentSetupDialog planId={planId} patientId={plan.patient_id} netTotal={net} onClose={() => setDialog(null)} />
      )}
      {dialog === 'revise' && installments?.installment_plan_id && (
        <InstallmentSetupDialog planId={planId} patientId={plan.patient_id} netTotal={net}
          revise={{ installmentPlanId: installments.installment_plan_id, alreadyPaid: installments.total_paid ?? 0 }}
          onClose={() => setDialog(null)} />
      )}
      {dialog === 'dictate' && (
        <DictatePlanDialog planId={planId} procedures={procedures} onClose={() => setDialog(null)} />
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
      {dialog === 'cancelPlan' && (
        <Modal title={t('plan.cancelPlan')} onClose={() => setDialog(null)}>
          <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) scrapPlan.mutate('cancel') }}>
            <p>{t('plan.cancelPlanExplain')}</p>
            <label className="field">
              <span>{t('reverse.reason')}</span>
              <input required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus />
            </label>
            {scrapPlan.isError && <ErrorNote error={scrapPlan.error} />}
            <div className="dialog-actions">
              <button type="submit" className="btn btn-danger" disabled={!reason.trim() || scrapPlan.isPending}>
                {t('plan.cancelPlan')}
              </button>
              <button type="button" className="btn" onClick={() => setDialog(null)}>{t('common.close')}</button>
            </div>
            {/* Only for a plan nothing has happened on: no money, no visits, no schedule. */}
            {!installments && sessions.length === 0 && planPayments.length === 0 && (
              <>
                <hr className="rule" />
                <p className="hint">{t('plan.deletePlanExplain')}</p>
                <button type="button" className="link-btn danger-link" disabled={scrapPlan.isPending}
                  onClick={() => { if (confirm(t('plan.deletePlanConfirm'))) scrapPlan.mutate('delete') }}>
                  {t('plan.deletePlan')}
                </button>
              </>
            )}
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
