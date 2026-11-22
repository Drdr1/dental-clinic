import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { toIsoDate } from '../../lib/dates'
import { Modal } from '../../components/Modal'
import { addLab, getCases, getInvoiceCheck, getLabs, type LabFilter } from './api'
import { LabCaseDialog } from './LabCaseDialog'
import { LabCaseList } from './LabCaseList'

const FILTERS: LabFilter[] = ['open', 'received', 'done']

function monthRange(offset: number) {
  const d = new Date()
  const from = new Date(d.getFullYear(), d.getMonth() + offset, 1)
  const to = offset === 0 ? new Date() : new Date(d.getFullYear(), d.getMonth() + offset + 1, 0)
  return { from: toIsoDate(from), to: toIsoDate(to) }
}

export function LabsPage() {
  const { clinicId } = useMember()
  const { t, money, lang } = useI18n()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<LabFilter>('open')
  const [adding, setAdding] = useState(false)
  const [newLab, setNewLab] = useState<null | { name: string; phone: string }>(null)
  const q = useQuery({ queryKey: ['lab-cases', clinicId, filter], queryFn: () => getCases(clinicId, filter) })
  // The three counts on the chips, whichever list is showing.
  const counts = useQuery({
    queryKey: ['lab-counts', clinicId],
    queryFn: async () => {
      const [open, received, done] = await Promise.all([
        getCases(clinicId, 'open'), getCases(clinicId, 'received'), getCases(clinicId, 'done'),
      ])
      const monthStart = monthRange(0).from
      return {
        open: open.length, late: open.filter((c) => c.stage_late).length, received: received.length,
        done: done.filter((c) => (c.fitted_on ?? '') >= monthStart).length,
        // How long each lab takes, from the cases that came back (recent ones first).
        turnaround: [...received, ...done].filter((c) => c.turnaround_days != null),
      }
    },
  })
  // What the clinic expects to be billed for work that came back: this month or last.
  const [monthOffset, setMonthOffset] = useState(0)
  const month = monthRange(-monthOffset)
  const labs = useQuery({ queryKey: ['labs', clinicId], queryFn: () => getLabs(clinicId) })
  const invoice = useQuery({
    queryKey: ['lab-invoice', clinicId, month.from, month.to],
    queryFn: () => getInvoiceCheck(clinicId, month.from, month.to),
  })
  const saveLab = useMutation({
    mutationFn: (l: { name: string; phone: string }) => addLab(clinicId, l.name, l.phone),
    onSuccess: () => { setNewLab(null); qc.invalidateQueries({ queryKey: ['labs'] }) },
  })

  // Nearest patient appointment first: that is the work to chase.
  const cases = [...(q.data ?? [])].sort((a, b) =>
    (a.next_appointment_at ?? '9999').localeCompare(b.next_appointment_at ?? '9999') ||
    (a.next_due ?? '9999').localeCompare(b.next_due ?? '9999'))
  const monthName = (offset: number) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long' })
    .format(new Date(new Date().getFullYear(), new Date().getMonth() - offset, 1))
  const expectedTotal = (invoice.data ?? []).reduce((s, r) => s + r.expected, 0)

  const byLab = new Map<string, { name: string; days: number[] }>()
  for (const c of counts.data?.turnaround ?? []) {
    if (!c.lab_id) continue
    const e = byLab.get(c.lab_id) ?? { name: c.lab_name ?? '', days: [] }
    e.days.push(c.turnaround_days as number)
    byLab.set(c.lab_id, e)
  }
  const speed = [...byLab].map(([id, e]) => ({ id, name: e.name, avg: Math.round(e.days.reduce((a, b) => a + b, 0) / e.days.length) }))
    .sort((a, b) => a.avg - b.avg)
  const slowest = Math.max(1, ...speed.map((x) => x.avg))

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{t('lab.title')}</h1>
          {counts.data && <p className="muted">{t('lab.subtitle', { n: counts.data.open, late: counts.data.late })}</p>}
        </div>
        <div className="row-buttons">
          <button className="btn" onClick={() => setNewLab({ name: '', phone: '' })}>{t('lab.addLab')}</button>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>{t('lab.new')}</button>
        </div>
      </header>

      <div className="plan-grid">
        <section className="panel">
          <div className="panel-head">
            <div className="chips">
              {FILTERS.map((f) => (
                <button key={f} className={`chip chip-lg${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
                  {t(`lab.chip.${f}` as Parameters<typeof t>[0], { n: counts.data ? (f === 'open' ? counts.data.open : f === 'received' ? counts.data.received : counts.data.done) : '' })}
                </button>
              ))}
            </div>
            <span className="muted small">{t('lab.sortHint')}</span>
          </div>
          {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
          {q.isPending && <Skeleton rows={4} variant="list" />}
          {q.data?.length === 0 && <p className="empty">{t(`lab.empty.${filter}` as Parameters<typeof t>[0])}</p>}
          {cases.length > 0 && <LabCaseList cases={cases} />}
        </section>

        <aside className="plan-side">
          <section className="panel">
            <div className="panel-head">
              <h2>{t('lab.invoiceTitle')}</h2>
              <div className="seg seg-small">
                <button className={monthOffset === 0 ? 'on' : ''} onClick={() => setMonthOffset(0)}>{monthName(0)}</button>
                <button className={monthOffset === 1 ? 'on' : ''} onClick={() => setMonthOffset(1)}>{monthName(1)}</button>
              </div>
            </div>
            <p className="muted small">{t('lab.invoiceHint2')}</p>
            {invoice.isError && <ErrorNote error={invoice.error} onRetry={() => invoice.refetch()} />}
            {invoice.data?.length === 0 && <p className="muted">{t('lab.invoiceNone')}</p>}
            <ul className="sched-list">
              {(invoice.data ?? []).map((r) => (
                <li key={r.lab_id}>
                  <div>
                    <Link to={`/labs/${r.lab_id}`} className="row-link strong">{r.lab_name}</Link>
                    <p className="muted small">{t('lab.casesN', { n: r.cases })}</p>
                  </div>
                  <strong>{money(r.expected)}</strong>
                </li>
              ))}
            </ul>
            {(invoice.data?.length ?? 0) > 0 && (
              <div className="account-split"><strong>{t('lab.expected')}</strong><strong>{money(expectedTotal)}</strong></div>
            )}
          </section>

          <section className="panel">
            <h2>{t('lab.avgTurnaround')}</h2>
            {speed.length === 0 && <p className="muted">{t('lab.noTurnaround')}</p>}
            <ul className="speed-list">
              {speed.map((x, i) => (
                <li key={x.id}>
                  <div className="account-split"><Link to={`/labs/${x.id}`} className="row-link">{x.name}</Link><strong>{t('lab.daysN', { n: x.avg })}</strong></div>
                  <div className={`kpi-bar${i === speed.length - 1 && speed.length > 1 ? ' is-bad' : ''}`}><span style={{ width: `${(x.avg / slowest) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
            {(labs.data ?? []).filter((l) => !byLab.has(l.id)).length > 0 && (
              <p className="muted small">
                {(labs.data ?? []).filter((l) => !byLab.has(l.id)).map((l, i) => (
                  <span key={l.id}>{i > 0 && ' · '}<Link to={`/labs/${l.id}`}>{l.name}</Link></span>
                ))}
              </p>
            )}
          </section>
        </aside>
      </div>

      {adding && <LabCaseDialog onClose={() => setAdding(false)} />}
      {newLab && (
        <Modal title={t('lab.addLab')} onClose={() => setNewLab(null)}>
          <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); if (newLab.name.trim()) saveLab.mutate(newLab) }}>
            <label className="field"><span>{t('lab.newLabName')}</span>
              <input required autoFocus value={newLab.name} onChange={(e) => setNewLab({ ...newLab, name: e.target.value })} /></label>
            <label className="field"><span>{t('lab.newLabPhone')}</span>
              <input dir="ltr" inputMode="tel" value={newLab.phone} onChange={(e) => setNewLab({ ...newLab, phone: e.target.value })} /></label>
            {saveLab.isError && <ErrorNote error={saveLab.error} />}
            <div className="dialog-actions">
              <button type="submit" className="btn btn-primary" disabled={saveLab.isPending}>{t('common.save')}</button>
              <button type="button" className="btn" onClick={() => setNewLab(null)}>{t('common.cancel')}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
