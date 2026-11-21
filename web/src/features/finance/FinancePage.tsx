import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import type { MessageKey } from '../../i18n/en'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { toIsoDate, todayLocal } from '../../lib/dates'
import { PAYMENT_METHODS, type PaymentMethod } from '../payments/api'
import { methodKey } from '../payments/labels'
import { AUTO_CATEGORIES, CATEGORIES, addExpense, getDoctorEarnings, getExpenses, getPatientSources, getProfit, getSummary, getTrend, voidExpense, type Expense, type ExpenseCategory } from './api'
import { getSettings } from '../settings/api'
import { TrendChart } from './TrendChart'

function monthRange(offset: number) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { from: toIsoDate(first), to: offset === 0 ? todayLocal() : toIsoDate(last) }
}

const catKey = (c: string) => `fin.cat.${c}` as MessageKey

function AddExpenseDialog({ onClose, income, adminPercent }: { onClose: () => void; income: number; adminPercent: number }) {
  const { clinicId } = useMember()
  const { t, money } = useI18n()
  const qc = useQueryClient()
  const [e, setE] = useState({ spent_on: todayLocal(), category: 'rent' as ExpenseCategory, amount: '', method: 'cash' as PaymentMethod, paid_to: '', note: '' })
  const save = useMutation({
    mutationFn: () => addExpense(clinicId, { ...e, amount: Number(e.amount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance'] }); onClose() },
  })
  const suggested = Math.round(income * adminPercent) / 100
  function onSubmit(ev: FormEvent) { ev.preventDefault(); if (Number(e.amount) > 0 && !save.isPending) save.mutate() }
  return (
    <Modal title={t('fin.addExpense')} onClose={onClose}>
      <form className="dialog-form" onSubmit={onSubmit}>
        <div className="field-row">
          <label className="field"><span>{t('fin.category')}</span>
            <select value={e.category} onChange={(x) => setE({ ...e, category: x.target.value as ExpenseCategory })}>
              {CATEGORIES.filter((c) => !AUTO_CATEGORIES.includes(c)).map((c) => <option key={c} value={c}>{t(catKey(c))}</option>)}
            </select></label>
          <label className="field"><span>{t('pay.amount')}</span>
            <input type="number" min="0.01" step="any" required dir="ltr" value={e.amount} onChange={(x) => setE({ ...e, amount: x.target.value })} autoFocus /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>{t('receipt.date')}</span>
            <input type="date" required max={todayLocal()} value={e.spent_on} onChange={(x) => setE({ ...e, spent_on: x.target.value })} /></label>
          <label className="field"><span>{t('pay.method')}</span>
            <select value={e.method} onChange={(x) => setE({ ...e, method: x.target.value as PaymentMethod })}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(methodKey(m))}</option>)}
            </select></label>
        </div>
        {e.category === 'admin' && adminPercent > 0 && income > 0 && (
          <p className="hint">
            {t('fin.adminSuggestion', { percent: adminPercent, amount: money(suggested) })}{' '}
            <button type="button" className="link-btn" onClick={() => setE({ ...e, amount: String(suggested) })}>
              {t('fin.adminUse')}
            </button>
          </p>
        )}
        <label className="field"><span>{t('fin.paidTo')}</span><input value={e.paid_to} onChange={(x) => setE({ ...e, paid_to: x.target.value })} maxLength={80} /></label>
        <label className="field"><span>{t('pay.note')}</span><input value={e.note} onChange={(x) => setE({ ...e, note: x.target.value })} maxLength={200} /></label>
        <p className="hint">{t('fin.autoHint')}</p>
        {save.isError && <ErrorNote error={save.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={!(Number(e.amount) > 0) || save.isPending}>{t('common.save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}

function VoidDialog({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const { t, money } = useI18n()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const save = useMutation({ mutationFn: () => voidExpense(expense.id, reason), onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance'] }); onClose() } })
  return (
    <Modal title={t('fin.voidTitle')} onClose={onClose}>
      <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) save.mutate() }}>
        <p>{t('fin.voidExplain', { amount: money(expense.amount), cat: t(catKey(expense.category)) })}</p>
        <label className="field"><span>{t('reverse.reason')}</span><input required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></label>
        {save.isError && <ErrorNote error={save.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-danger" disabled={!reason.trim() || save.isPending}>{t('fin.void')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function FinancePage() {
  const { clinicId, role } = useMember()
  const { t, money, date } = useI18n()
  const [range, setRange] = useState(() => monthRange(0))
  const [preset, setPreset] = useState<'this' | 'last' | 'custom'>('this')
  const [adding, setAdding] = useState(false)
  const [voiding, setVoiding] = useState<Expense | null>(null)
  const enabled = role === 'owner'
  const summary = useQuery({ queryKey: ['finance', 'summary', clinicId, range], queryFn: () => getSummary(clinicId, range.from, range.to), enabled })
  const prevRange = preset === 'this' ? monthRange(-1) : null
  const prev = useQuery({
    queryKey: ['finance', 'summary', clinicId, prevRange], queryFn: () => getSummary(clinicId, prevRange!.from, prevRange!.to),
    enabled: enabled && !!prevRange,
  })
  const trend = useQuery({ queryKey: ['finance', 'trend', clinicId], queryFn: () => getTrend(clinicId), enabled })
  const earnings = useQuery({
    queryKey: ['finance', 'earnings', clinicId, range], queryFn: () => getDoctorEarnings(clinicId, range.from, range.to), enabled,
  })
  const sources = useQuery({
    queryKey: ['finance', 'sources', clinicId, range], queryFn: () => getPatientSources(clinicId, range.from, range.to), enabled,
  })
  const expenses = useQuery({ queryKey: ['finance', 'expenses', clinicId, range], queryFn: () => getExpenses(clinicId, range.from, range.to), enabled })
  const profit = useQuery({ queryKey: ['finance', 'profit', clinicId, range], queryFn: () => getProfit(clinicId, range.from, range.to), enabled })
  // Only for the suggested management fee in the expense dialog.
  const clinic = useQuery({ queryKey: ['settings', clinicId], queryFn: () => getSettings(clinicId), enabled, select: (d) => d.clinic })

  if (!enabled) return <section className="page"><p className="empty">{t('fin.ownerOnly')}</p></section>

  const s = summary.data
  const pick = (p: 'this' | 'last') => { setPreset(p); setRange(monthRange(p === 'this' ? 0 : -1)) }

  return (
    <section className="page finance">
      <header className="page-head">
        <h1>{t('fin.title')}</h1>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>{t('fin.addExpense')}</button>
      </header>

      <div className="toolbar">
        <div className="segmented">
          <button className={preset === 'this' ? 'is-active' : ''} onClick={() => pick('this')}>{t('fin.thisMonth')}</button>
          <button className={preset === 'last' ? 'is-active' : ''} onClick={() => pick('last')}>{t('fin.lastMonth')}</button>
          <button className={preset === 'custom' ? 'is-active' : ''} onClick={() => setPreset('custom')}>{t('fin.custom')}</button>
        </div>
        {preset === 'custom' && (
          <span className="inline-controls">
            <input type="date" className="date-jump" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
            <span>—</span>
            <input type="date" className="date-jump" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
          </span>
        )}
      </div>

      {summary.isError && <ErrorNote error={summary.error} onRetry={() => summary.refetch()} />}

      {s && (
        <>
          <div className="fin-figures">
            <div className="fin-figure">
              <span>{t('fin.income')}</span><strong>{money(s.income)}</strong>
              {prev.data && <small className="muted">{t('fin.lastMonthWas', { amount: money(prev.data.income) })}</small>}
            </div>
            <div className="fin-figure">
              <span>{t('fin.expenses')}</span><strong>{money(s.expenses)}</strong>
              {prev.data && <small className="muted">{t('fin.lastMonthWas', { amount: money(prev.data.expenses) })}</small>}
            </div>
            <div className={`fin-figure fin-net ${s.net < 0 ? 'is-negative' : ''}`}>
              <span>{t('fin.net')}</span><strong>{money(s.net)}</strong>
              {prev.data && <small className="muted">{t('fin.lastMonthWas', { amount: money(prev.data.net) })}</small>}
            </div>
          </div>

          <div className="patient-grid">
            <section className="panel">
              <h2>{t('fin.incomeByMethod')}</h2>
              <dl className="totals wide">
                {Object.entries(s.income_by_method).sort((a, b) => b[1] - a[1]).map(([m, v]) => (
                  <div key={m}><dt>{t(methodKey(m))}</dt><dd>{money(v)}</dd></div>
                ))}
                {Object.keys(s.income_by_method).length === 0 && <p className="muted">{t('fin.noIncome')}</p>}
                {s.reversals > 0 && <div><dt className="muted">{t('fin.reversalsIncluded')}</dt><dd className="muted">{money(s.reversals)}</dd></div>}
              </dl>
            </section>
            <section className="panel">
              <h2>{t('fin.expensesByCategory')}</h2>
              <dl className="totals wide">
                {Object.entries(s.expenses_by_category).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
                  <div key={c}><dt>{t(catKey(c))}</dt><dd>{money(v)}</dd></div>
                ))}
                {Object.keys(s.expenses_by_category).length === 0 && <p className="muted">{t('fin.noExpenses')}</p>}
              </dl>
            </section>
            <section className="panel">
              <h2>{t('fin.rightNow')}</h2>
              <dl className="totals wide">
                <div><dt>{t('fin.owed')}</dt><dd>{money(s.owed_now)}</dd></div>
                <div><dt>{t('fin.overdue')}</dt><dd className={s.overdue_now > 0 ? 'danger-text' : ''}>{money(s.overdue_now)}</dd></div>
                <div><dt>{t('fin.stockValue')}</dt><dd>{money(s.stock_value)}</dd></div>
              </dl>
            </section>
          </div>
        </>
      )}

      {profit.isError && <ErrorNote error={profit.error} onRetry={() => profit.refetch()} />}
      {profit.data && (
        <section className="panel">
          <h2>{t('fin.profitTitle')}</h2>
          <p className="muted small">{t('fin.profitHint')}</p>
          <dl className="totals wide">
            <div><dt>{t('fin.income')}</dt><dd>{money(profit.data.income)}</dd></div>
            <div>
              <dt>− {t('fin.cat.doctors')}</dt>
              <dd>{money(profit.data.doctor_commission)}</dd>
            </div>
            {Object.entries(profit.data.expenses_by_category).sort((a, b) => b[1] - a[1]).map(([c, v]) => (
              <div key={c}><dt>− {t(catKey(c))}</dt><dd>{money(v)}</dd></div>
            ))}
            <div className="totals-net">
              <dt>{t('fin.netProfit')}</dt>
              <dd className={profit.data.net_profit < 0 ? 'danger-text' : ''}>{money(profit.data.net_profit)}</dd>
            </div>
          </dl>

          {profit.data.commission_due !== 0 && (
            <p className="muted small">
              {t('fin.commissionDue', {
                due: money(profit.data.commission_due), paid: money(profit.data.commission_paid),
              })}
            </p>
          )}

          <hr className="rule" />
          <h3>{t('fin.partnerSplit')}</h3>
          {profit.data.partners.length === 0 && <p className="muted">{t('fin.noPartners')}</p>}
          {profit.data.partners.length > 0 && (
            <>
              <dl className="totals wide">
                {profit.data.partners.map((p) => (
                  <div key={p.id}>
                    <dt>{p.name} <span className="muted">({p.percent}%)</span></dt>
                    <dd>{money(p.amount)}</dd>
                  </div>
                ))}
              </dl>
              {Math.abs(profit.data.partner_percent_total - 100) > 0.01 && (
                <p className="danger-text small">
                  {t('fin.partnerPercentOff', { total: profit.data.partner_percent_total })}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {trend.data && trend.data.some((m) => m.income > 0 || m.expenses > 0) && (
        <section className="panel">
          <h2>{t('fin.trend')}</h2>
          <TrendChart points={trend.data} />
        </section>
      )}

      <div className="patient-grid">
        {(earnings.data?.length ?? 0) > 0 && (
          <section className="panel">
            <h2>{t('fin.doctorEarnings')}</h2>
            <p className="muted small">
              {earnings.data![0].basis === 'work' ? t('settings.basisWork')
                : earnings.data![0].basis === 'collection' ? t('settings.basisCollection')
                : t('settings.basisNetLab')}
            </p>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead><tr>
                  <th>{t('team.name')}</th>
                  <th className="num">{t('fin.collected')}</th>
                  <th className="num">{t('fin.labDeduction')}</th>
                  <th className="num">{t('fin.base')}</th>
                  <th className="num">%</th>
                  <th className="num">{t('fin.earned')}</th>
                </tr></thead>
                <tbody>
                  {earnings.data!.map((d) => (
                    <tr key={d.user_id}>
                      <td>{d.display_name}</td>
                      <td className="num">{money(d.collected)}</td>
                      <td className="num muted">{d.lab_cost ? `− ${money(d.lab_cost)}` : '—'}</td>
                      <td className="num">{money(d.base_amount)}</td>
                      <td className="num muted">{d.percent}%</td>
                      <td className="num"><strong>{money(d.earned)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {(sources.data?.length ?? 0) > 0 && (
          <section className="panel">
            <h2>{t('fin.sources')}</h2>
            <p className="muted small">{t('fin.sourcesHint')}</p>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead><tr><th>{t('patientForm.source')}</th><th className="num">{t('fin.newPatients')}</th><th className="num">{t('fin.income')}</th></tr></thead>
                <tbody>
                  {sources.data!.map((s2) => (
                    <tr key={s2.source}>
                      <td>{t(`source.${s2.source}` as MessageKey)}</td>
                      <td className="num">{s2.patients}</td>
                      <td className="num">{money(s2.collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <section className="panel">
        <h2>{t('fin.expenseList')}</h2>
        {expenses.isError && <ErrorNote error={expenses.error} />}
        {expenses.data?.length === 0 && <p className="muted">{t('fin.noExpenses')}</p>}
        {expenses.data && expenses.data.length > 0 && (
          <div className="table-wrap">
            <table className="table table-compact">
              <thead><tr>
                <th>{t('receipt.date')}</th><th>{t('fin.category')}</th><th>{t('fin.details')}</th>
                <th className="num">{t('pay.amount')}</th><th />
              </tr></thead>
              <tbody>
                {expenses.data.map((e) => (
                  <tr key={e.id} className={e.voided_at ? 'is-void-row' : ''}>
                    <td>{date(e.spent_on)}</td>
                    <td>{t(catKey(e.category))}{(e.lab_case_id || e.material_movement_id) && <span className="badge badge-muted"> {t('fin.auto')}</span>}</td>
                    <td className="muted">{[e.paid_to, e.note].filter(Boolean).join(' — ')}{e.voided_at && <> — {t('fin.voided', { reason: e.void_reason ?? '' })}</>}</td>
                    <td className="num">{money(e.amount)}{e.method && <p className="muted small">{t(methodKey(e.method))}</p>}</td>
                    <td className="num">
                      {!e.voided_at && !e.lab_case_id && (
                        <button className="link-btn danger-link" onClick={() => setVoiding(e)}>{t('fin.void')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adding && (
        <AddExpenseDialog
          onClose={() => setAdding(false)}
          income={s?.income ?? 0}
          adminPercent={clinic.data?.admin_percent ?? 0}
        />
      )}
      {voiding && <VoidDialog expense={voiding} onClose={() => setVoiding(null)} />}
    </section>
  )
}
