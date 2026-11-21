import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { toIsoDate, todayLocal } from '../../lib/dates'
import { getCases, getInvoiceCheck, getLabs, type LabFilter } from './api'
import { LabCaseDialog } from './LabCaseDialog'
import { LabCaseList } from './LabCaseList'

const FILTERS: LabFilter[] = ['open', 'received', 'done']

export function LabsPage() {
  const { clinicId } = useMember()
  const { t, money } = useI18n()
  const [filter, setFilter] = useState<LabFilter>('open')
  const [adding, setAdding] = useState(false)
  const q = useQuery({ queryKey: ['lab-cases', clinicId, filter], queryFn: () => getCases(clinicId, filter) })
  // What the clinic expects to be billed for work that came back this month.
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return { from: toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1)), to: todayLocal() }
  })
  // Every lab, so its file is reachable even in a month with no work.
  const labs = useQuery({ queryKey: ['labs', clinicId], queryFn: () => getLabs(clinicId) })
  const invoice = useQuery({
    queryKey: ['lab-invoice', clinicId, month],
    queryFn: () => getInvoiceCheck(clinicId, month.from, month.to),
  })

  return (
    <section className="page">
      <header className="page-head">
        <h1>{t('lab.title')}</h1>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>{t('lab.new')}</button>
      </header>

      <div className="segmented" role="tablist">
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'is-active' : ''}
            onClick={() => setFilter(f)}>
            {t(`lab.filter.${f}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.isPending && <Skeleton rows={4} variant="list" />}
      {q.data?.length === 0 && <p className="empty">{t(`lab.empty.${filter}` as Parameters<typeof t>[0])}</p>}
      {q.data && q.data.length > 0 && (
        <section className="panel"><LabCaseList cases={q.data} /></section>
      )}

      {(invoice.data?.length ?? 0) > 0 && (
        <section className="panel">
          <h2>{t('lab.invoiceTitle')}</h2>
          <p className="muted small">{t('lab.invoiceHint')}</p>
          <span className="inline-controls">
            <input type="date" className="date-jump" value={month.from} max={month.to}
              onChange={(e) => e.target.value && setMonth({ ...month, from: e.target.value })} />
            <span>—</span>
            <input type="date" className="date-jump" value={month.to} min={month.from}
              onChange={(e) => e.target.value && setMonth({ ...month, to: e.target.value })} />
          </span>
          <div className="table-wrap">
            <table className="table table-compact">
              <thead><tr>
                <th>{t('lab.lab')}</th>
                <th className="num">{t('lab.caseCount')}</th>
                <th className="num">{t('lab.units')}</th>
                <th className="num">{t('lab.expectedCost')}</th>
              </tr></thead>
              <tbody>
                {invoice.data!.map((r) => (
                  <tr key={r.lab_id}>
                    <td><Link to={`/labs/${r.lab_id}`} className="row-link strong">{r.lab_name}</Link></td>
                    <td className="num">{r.cases}</td>
                    <td className="num">{r.units}</td>
                    <td className="num"><strong>{money(r.expected)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(labs.data?.length ?? 0) > 0 && (
        <section className="panel">
          <h2>{t('lab.labs')}</h2>
          <ul className="chair-list">
            {labs.data!.map((l) => (
              <li key={l.id}>
                <Link to={`/labs/${l.id}`} className="row-link strong">{l.name}</Link>
                {l.phone && <span className="muted" dir="ltr"> · {l.phone}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {adding && <LabCaseDialog onClose={() => setAdding(false)} />}
    </section>
  )
}
