import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { Link } from 'react-router'
import { useI18n } from '../../i18n'
import type { MessageKey } from '../../i18n/en'
import { methodKey } from '../payments/labels'
import { ErrorNote } from '../../components/ErrorNote'
import { shiftDate } from '../appointments/time'
import { todayLocal } from '../../lib/dates'
import { closeDay, getClosers, getClosings, getDay } from './api'

export function CashPage() {
  const { clinicId, role } = useMember()
  const { t, money, date: fmtDate, time } = useI18n()
  const qc = useQueryClient()
  const [day, setDay] = useState(todayLocal())
  const [counted, setCounted] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
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

  if (!canCash) return <section className="page"><p className="empty">{t('cash.ownerOnly')}</p></section>

  const s = summary.data
  const diff = s && counted !== '' ? Math.round((Number(counted) - s.expected_cash) * 100) / 100 : null
  const needsReason = diff !== null && diff !== 0
  const canSave = counted !== '' && Number(counted) >= 0 && (!needsReason || reason.trim().length > 0)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (canSave && !save.isPending) save.mutate()
  }

  return (
    <section className="page">
      <header className="page-head">
        <h1>{t('cash.title')}</h1>
        <div className="head-actions">
          <button className="btn" onClick={() => setDay(shiftDate(day, -1))}>{t('appt.prevDay')}</button>
          {day !== todayLocal() && <button className="btn" onClick={() => setDay(todayLocal())}>{t('appt.today')}</button>}
          <input type="date" className="date-jump" value={day} max={todayLocal()} aria-label={t('receipt.date')}
            onChange={(e) => e.target.value && setDay(e.target.value)} />
        </div>
      </header>

      {summary.isError && <ErrorNote error={summary.error} onRetry={() => summary.refetch()} />}
      {s && (
        <section className="panel">
          <h2>{fmtDate(s.date)}</h2>
          <dl className="totals wide">
            {s.opening_float > 0 && <div><dt>{t('cash.float')}</dt><dd>{money(s.opening_float)}</dd></div>}
            <div><dt>{t('cash.in')}</dt><dd>{money(s.cash_in)}</dd></div>
            <div><dt>{t('cash.out')}</dt><dd>−{money(s.cash_out)}</dd></div>
            <div className="totals-net"><dt>{t('cash.expected')}</dt><dd>{money(s.expected_cash)}</dd></div>
          </dl>

          {/* The day itself, so a count that doesn't match can be traced to a line. */}
          {s.payments.length > 0 && (
            <>
              <h3>{t('cash.tookToday', { n: s.payments.length })}</h3>
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead><tr>
                    <th>{t('cash.at')}</th>
                    <th>{t('receipt.receivedFrom')}</th>
                    <th>{t('pay.method')}</th>
                    <th>{t('cash.takenBy')}</th>
                    <th className="num">{t('pay.amount')}</th>
                  </tr></thead>
                  <tbody>
                    {s.payments.map((p) => (
                      <tr key={p.id} className={p.is_reversal ? 'is-void-row' : ''}>
                        <td className="muted clock">{time(p.at)}</td>
                        <td>
                          <Link to={`/patients/${p.patient_id}`} className="row-link">{p.patient}</Link>
                          {p.note && <p className="muted small">{p.note}</p>}
                        </td>
                        <td>
                          {t(methodKey(p.method))}
                          {p.method !== 'cash' && <span className="badge badge-muted"> {t('cash.notInDrawer')}</span>}
                        </td>
                        <td className="muted">{p.taken_by}</td>
                        <td className="num">{money(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="totals wide">
                {Object.entries(s.income_by_method).sort((a, b) => b[1] - a[1]).map(([mth, v]) => (
                  <div key={mth}><dt>{t(methodKey(mth))}</dt><dd>{money(v)}</dd></div>
                ))}
              </dl>
            </>
          )}

          {s.cash_expenses.length > 0 && (
            <>
              <h3>{t('cash.paidOut')}</h3>
              <div className="table-wrap">
                <table className="table table-compact">
                  <tbody>
                    {s.cash_expenses.map((e) => (
                      <tr key={e.id}>
                        <td>{t(`fin.cat.${e.category}` as MessageKey)}</td>
                        <td className="muted">{[e.paid_to, e.note].filter(Boolean).join(' — ')}</td>
                        <td className="num">−{money(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {s.closing ? (
            <div className="closed-box">
              <p><strong>{t('cash.closedAlready')}</strong></p>
              <dl className="totals wide">
                <div><dt>{t('cash.counted')}</dt><dd>{money(s.closing.counted_cash)}</dd></div>
                <div><dt>{t('cash.difference')}</dt>
                  <dd className={s.closing.difference === 0 ? 'ok-text' : 'danger-text'}>
                    {s.closing.difference === 0 ? t('cash.exact') : money(s.closing.difference)}
                  </dd></div>
              </dl>
              {s.closing.reason && <p className="muted">{s.closing.reason}</p>}
              <p className="muted small">
                {t('cash.closedBy', { name: closers.data?.get(s.closing.closed_by) ?? '', date: fmtDate(s.closing.closed_at) })}
              </p>
            </div>
          ) : (
            <form className="dialog-form" onSubmit={onSubmit}>
              <label className="field">
                <span>{t('cash.counted')}</span>
                <input type="number" min="0" step="any" dir="ltr" required value={counted}
                  onChange={(e) => setCounted(e.target.value)} autoFocus />
                <small className="hint">{t('cash.countedHint')}</small>
              </label>

              {diff !== null && (
                <p className={diff === 0 ? 'ok-text' : 'danger-text'}>
                  {diff === 0 ? t('cash.exact') : diff > 0 ? t('cash.over', { amount: money(diff) }) : t('cash.short', { amount: money(-diff) })}
                </p>
              )}
              {needsReason && (
                <label className="field"><span>{t('cash.reason')}</span>
                  <input required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
                    placeholder={t('cash.reasonHint')} /></label>
              )}
              <label className="field"><span>{t('pay.note')}</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></label>

              {save.isError && <ErrorNote error={save.error} />}
              <div className="dialog-actions">
                <button type="submit" className="btn btn-primary" disabled={!canSave || save.isPending}>
                  {save.isPending ? t('common.saving') : t('cash.close')}
                </button>
              </div>
              <p className="hint">{t('cash.finalHint')}</p>
            </form>
          )}
        </section>
      )}

      <section className="panel">
        <h2>{t('cash.history')}</h2>
        {history.data?.length === 0 && <p className="muted">{t('cash.noHistory')}</p>}
        {history.data && history.data.length > 0 && (
          <div className="table-wrap">
            <table className="table table-compact">
              <thead><tr>
                <th>{t('receipt.date')}</th><th className="num">{t('cash.expected')}</th><th className="num">{t('cash.counted')}</th>
                <th className="num">{t('cash.difference')}</th><th>{t('cash.reason')}</th><th>{t('cash.closedByShort')}</th>
              </tr></thead>
              <tbody>
                {history.data.map((c) => (
                  <tr key={c.id}>
                    <td><button className="link-btn row-link" onClick={() => setDay(c.business_date)}>{fmtDate(c.business_date)}</button></td>
                    <td className="num">{money(c.expected_cash)}</td>
                    <td className="num">{money(c.counted_cash)}</td>
                    <td className={`num ${c.difference === 0 ? 'muted' : 'danger-text'}`}>
                      {c.difference === 0 ? '—' : money(c.difference)}
                    </td>
                    <td className="muted">{c.reason}</td>
                    <td className="muted">{closers.data?.get(c.closed_by) ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
