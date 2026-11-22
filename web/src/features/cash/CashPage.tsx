import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { Link } from 'react-router'
import { useI18n } from '../../i18n'
import type { MessageKey } from '../../i18n/en'
import { methodKey } from '../payments/labels'
import { ErrorNote } from '../../components/ErrorNote'
import { todayLocal } from '../../lib/dates'
import { closeDay, getClosers, getClosings, getDay } from './api'
import { Modal } from '../../components/Modal'
import { AUTO_CATEGORIES, CATEGORIES, addExpense, type ExpenseCategory } from '../finance/api'

export function CashPage() {
  const { clinicId, role } = useMember()
  const { t, money, date: fmtDate, time, lang } = useI18n()
  const qc = useQueryClient()
  const [day, setDay] = useState(todayLocal())
  const [counted, setCounted] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [payingOut, setPayingOut] = useState(false)
  const [out, setOut] = useState<{ note: string; amount: string; category: ExpenseCategory }>({ note: '', amount: '', category: 'other' })
  // Reception holds the drawer and counts it at night, so she gets this
  // screen. The money reports stay owner-only.
  const canCash = role === 'owner' || role === 'receptionist'

  const summary = useQuery({ queryKey: ['cash', clinicId, day], queryFn: () => getDay(clinicId, day), enabled: canCash })
  const history = useQuery({ queryKey: ['cash-history', clinicId], queryFn: () => getClosings(clinicId), enabled: canCash })
  const closers = useQuery({ queryKey: ['closers', clinicId], queryFn: () => getClosers(clinicId), enabled: canCash })

  const save = useMutation({
    mutationFn: () => closeDay(clinicId, day, Number(counted), reason, note),
    onSuccess: () => {
      setCounted(''); setReason(''); setNote('')
      qc.invalidateQueries({ queryKey: ['cash'] })
      qc.invalidateQueries({ queryKey: ['cash-history'] })
    },
  })

  // Petty cash out of the drawer is an expense paid in cash on that day (owner only, as expenses are).
  const payOut = useMutation({
    mutationFn: () => addExpense(clinicId, { spent_on: day, category: out.category, amount: Number(out.amount), method: 'cash', paid_to: '', note: out.note }),
    onSuccess: () => {
      setPayingOut(false); setOut({ note: '', amount: '', category: 'other' })
      qc.invalidateQueries({ queryKey: ['cash'] }); qc.invalidateQueries({ queryKey: ['finance'] })
    },
  })

  if (!canCash) return <section className="page"><p className="empty">{t('cash.ownerOnly')}</p></section>

  const s = summary.data
  const diff = s && counted !== '' ? Math.round((Number(counted) - s.expected_cash) * 100) / 100 : null
  const needsReason = diff !== null && diff !== 0
  const canSave = counted !== '' && Number(counted) >= 0 && (!needsReason || reason.trim().length > 0)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (canSave && !save.isPending) save.mutate()
  }

  const isToday = day === todayLocal()
  const total = (s?.payments ?? []).filter((p) => !p.is_reversal).reduce((sum, p) => sum + p.amount, 0)
  const recent = showAll ? history.data ?? [] : (history.data ?? []).slice(0, 5)
  const weekday = (d: string) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${d}T12:00:00`))

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{t('cash.title')}</h1>
          <p className="muted">
            {weekday(day)} · {s?.closing ? t('cash.dayClosed') : isToday ? t('cash.dayOpen') : t('cash.dayNotClosed')}
            {!isToday && <> · <button className="link-btn link-strong" onClick={() => setDay(todayLocal())}>{t('cash.backToToday')}</button></>}
          </p>
        </div>
        <div className="row-buttons">
          {role === 'owner' && <Link className="btn" to="/finance">{t('cash.monthReport')}</Link>}
        </div>
      </header>

      {summary.isError && <ErrorNote error={summary.error} onRetry={() => summary.refetch()} />}
      {s && (
        <>
          <div className="cash-eq">
            <article className="kpi"><span className="kpi-sub">{t('cash.float')}</span><strong className="kpi-value">{money(s.opening_float)}</strong></article>
            <span className="eq-op">+</span>
            <article className="kpi"><span className="kpi-sub">{t('cash.in')}</span><strong className="kpi-value">{money(s.cash_in)}</strong></article>
            <span className="eq-op">−</span>
            <article className="kpi"><span className="kpi-sub">{t('cash.out')}</span><strong className="kpi-value">{money(s.cash_out)}</strong></article>
            <span className="eq-op">=</span>
            <article className="kpi kpi-ink"><span className="kpi-sub">{t('cash.expected')}</span><strong className="kpi-value">{money(s.expected_cash)}</strong></article>
          </div>

          <div className="plan-grid">
            <div className="plan-main">
              <section className="panel">
                <div className="panel-head">
                  <h2>{isToday ? t('cash.todayTakings') : t('cash.dayTakings')}</h2>
                  {s.payments.length > 0 && (
                    <span className="muted small">{t('cash.takingsSub', { n: s.payments.length, total: money(total), cash: money(s.cash_in) })}</span>
                  )}
                </div>
                {s.payments.length === 0 && <p className="muted">{t('cash.noTakings')}</p>}
                {s.payments.length > 0 && (
                  <div className="table-scroll">
                    <table className="table table-plain">
                      <thead><tr>
                        <th>{t('cash.at')}</th>
                        <th>{t('patients.col.patient')}</th>
                        <th>{t('pay.amount')}</th>
                        <th>{t('pay.method')}</th>
                        <th className="hide-phone">{t('cash.takenBy')}</th>
                      </tr></thead>
                      <tbody>
                        {s.payments.map((p) => (
                          <tr key={p.id} className={p.is_reversal ? 'is-void-row' : ''}>
                            <td className="muted nowrap">{time(p.at)}</td>
                            <td>
                              <Link to={`/patients/${p.patient_id}`} className="row-link strong">{p.patient}</Link>
                              {p.note && <p className="muted small">{p.note}</p>}
                            </td>
                            <td className="strong nowrap">{money(p.amount)}</td>
                            <td className="nowrap">
                              <span className={`badge ${p.method === 'cash' ? 'badge-neutral' : 'badge-info'}`}>{t(methodKey(p.method))}</span>
                              {p.method !== 'cash' && <span className="muted small"> {t('cash.notInDrawer')}</span>}
                            </td>
                            <td className="hide-phone">{p.taken_by}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h2>{t('cash.paidOut')}</h2>
                  {role === 'owner' && !s.closing && (
                    <button className="btn btn-small" onClick={() => setPayingOut(true)}>{t('cash.payOut')}</button>
                  )}
                </div>
                {s.cash_expenses.length === 0 && <p className="muted">{t('cash.nothingOut')}</p>}
                <ul className="sched-list">
                  {s.cash_expenses.map((e) => (
                    <li key={e.id}>
                      <div>
                        <strong>{[e.note, e.paid_to].filter(Boolean).join(' · ') || t(`fin.cat.${e.category}` as MessageKey)}</strong>
                        <p className="muted small">{t(`fin.cat.${e.category}` as MessageKey)}</p>
                      </div>
                      <strong>{money(e.amount)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <aside className="plan-side">
              <section className="panel">
                <h2>{t('cash.close')}</h2>
                {s.closing ? (
                  <>
                    <div className="account-split"><span>{t('cash.counted')}</span><strong>{money(s.closing.counted_cash)}</strong></div>
                    <div className={`diff-box ${s.closing.difference === 0 ? 'ok' : s.closing.difference > 0 ? 'over' : 'short'}`}>
                      <span>{t('cash.difference')}</span>
                      <strong>{s.closing.difference === 0 ? t('cash.exactShort') : s.closing.difference > 0 ? t('cash.overShort', { amount: money(s.closing.difference) }) : t('cash.shortShort', { amount: money(-s.closing.difference) })}</strong>
                    </div>
                    {s.closing.reason && <p className="muted">{s.closing.reason}</p>}
                    <p className="muted small">{t('cash.closedBy', { name: closers.data?.get(s.closing.closed_by) ?? '', date: fmtDate(s.closing.closed_at) })}</p>
                  </>
                ) : (
                  <form className="dialog-form" onSubmit={onSubmit}>
                    <p className="muted">{t('cash.countedHint')}</p>
                    <label className="field">
                      <span>{t('cash.counted')}</span>
                      <input type="number" min="0" step="any" dir="ltr" required value={counted}
                        onChange={(e) => setCounted(e.target.value)} />
                    </label>
                    {diff !== null && (
                      <div className={`diff-box ${diff === 0 ? 'ok' : diff > 0 ? 'over' : 'short'}`}>
                        <span>{t('cash.difference')}</span>
                        <strong>{diff === 0 ? t('cash.exactShort') : diff > 0 ? t('cash.overShort', { amount: money(diff) }) : t('cash.shortShort', { amount: money(-diff) })}</strong>
                      </div>
                    )}
                    {needsReason && (
                      <label className="field"><span>{t('cash.reason')}</span>
                        <input required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
                          placeholder={t('cash.reasonHintShort')} /></label>
                    )}
                    {save.isError && <ErrorNote error={save.error} />}
                    <button type="submit" className="btn btn-ink btn-block" disabled={!canSave || save.isPending}>
                      {save.isPending ? t('common.saving') : t('cash.close')}
                    </button>
                    <p className="hint">{t('cash.finalHint')}</p>
                  </form>
                )}
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h2>{t('cash.history')}</h2>
                  <span className="row-buttons">
                    {(history.data?.length ?? 0) > 5 && (
                      <button className="link-btn link-strong" onClick={() => setShowAll((v) => !v)}>{showAll ? t('plan.showLess') : t('cash.all')}</button>
                    )}
                    <input type="date" className="date-jump date-small" value={day} max={todayLocal()} aria-label={t('cash.openDay')}
                      title={t('cash.openDay')} onChange={(e) => e.target.value && setDay(e.target.value)} />
                  </span>
                </div>
                {history.data?.length === 0 && <p className="muted">{t('cash.noHistory')}</p>}
                <ul className="sched-list">
                  {recent.map((c) => (
                    <li key={c.id}>
                      <div>
                        <button className="link-btn row-link strong" onClick={() => setDay(c.business_date)}>{weekday(c.business_date)}</button>
                        <p className="muted small">{t('cash.closedByName', { name: closers.data?.get(c.closed_by) ?? '' })}</p>
                      </div>
                      <span className={`badge ${c.difference === 0 ? 'badge-neutral' : c.difference > 0 ? 'badge-info' : 'badge-danger'}`}>
                        {c.difference === 0 ? t('cash.exactShort') : c.difference > 0 ? t('cash.overShort', { amount: Math.abs(c.difference) }) : t('cash.shortShort', { amount: Math.abs(c.difference) })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        </>
      )}

      {payingOut && (
        <Modal title={t('cash.payOut')} onClose={() => setPayingOut(false)}>
          <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); if (Number(out.amount) > 0) payOut.mutate() }}>
            <label className="field"><span>{t('cash.outWhat')}</span>
              <input required autoFocus value={out.note} onChange={(e) => setOut({ ...out, note: e.target.value })} placeholder={t('cash.outWhatHint')} maxLength={200} /></label>
            <label className="field"><span>{t('pay.amount')}</span>
              <input type="number" min="1" step="any" dir="ltr" required value={out.amount} onChange={(e) => setOut({ ...out, amount: e.target.value })} /></label>
            <label className="field"><span>{t('fin.category')}</span>
              <select value={out.category} onChange={(e) => setOut({ ...out, category: e.target.value as ExpenseCategory })}>
                {CATEGORIES.filter((c) => !AUTO_CATEGORIES.includes(c)).map((c) => <option key={c} value={c}>{t(`fin.cat.${c}` as MessageKey)}</option>)}
              </select></label>
            {payOut.isError && <ErrorNote error={payOut.error} />}
            <div className="dialog-actions">
              <button type="submit" className="btn btn-primary" disabled={payOut.isPending}>{t('common.save')}</button>
              <button type="button" className="btn" onClick={() => setPayingOut(false)}>{t('common.cancel')}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
