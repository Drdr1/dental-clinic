import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { whatsappLink } from '../../lib/phone'
import { getLabCases, getLabMonths, getLabs } from './api'
import { LabCaseList } from './LabCaseList'

/** The month a row stands for, as the range the case list needs. */
function monthRange(month: string) {
  const d = new Date(month)
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return { from: iso(first), to: iso(last) }
}

/** One lab's file: what it made, when, and what it is owed. */
export function LabPage() {
  const { id = '' } = useParams()
  const { clinicId } = useMember()
  const { t, money, date } = useI18n()
  const [open, setOpen] = useState<string | null>(null)

  const labs = useQuery({ queryKey: ['labs', clinicId], queryFn: () => getLabs(clinicId) })
  const months = useQuery({ queryKey: ['lab-months', clinicId, id], queryFn: () => getLabMonths(clinicId, id) })
  const range = open ? monthRange(open) : null
  const cases = useQuery({
    queryKey: ['lab-cases', clinicId, id, open],
    queryFn: () => getLabCases(clinicId, id, range!.from, range!.to),
    enabled: !!range,
  })

  const lab = labs.data?.find((l) => l.id === id)

  if (months.isError) return <section className="page"><ErrorNote error={months.error} onRetry={() => months.refetch()} /></section>
  if (labs.isPending || months.isPending) return <section className="page"><Skeleton rows={3} variant="cards" /></section>
  if (!lab) return <section className="page"><p className="empty">{t('lab.notFound')}</p></section>

  const all = months.data ?? []
  // Everything this lab has ever been owed, and what is still out there.
  const total = all.reduce((a, m) => a + Number(m.expected), 0)
  const stillOut = all.reduce((a, m) => a + Number(m.still_out), 0)

  return (
    <section className="page">
      <Link to="/labs" className="back-link">{t('common.back')}</Link>

      <header className="page-head">
        <div>
          <h1>{lab.name}</h1>
          {lab.phone && <p className="muted" dir="ltr">{lab.phone}</p>}
        </div>
        {lab.phone && (
          <div className="head-actions">
            <a className="btn" href={`tel:${lab.phone}`}>{t('patient.call')}</a>
            <a className="btn" target="_blank" rel="noreferrer" href={whatsappLink(lab.phone)}>{t('patient.whatsapp')}</a>
          </div>
        )}
      </header>

      <div className="stat-strip">
        <div className="stat"><div><strong>{all.reduce((a, m) => a + Number(m.cases), 0)}</strong><span>{t('lab.caseCount')}</span></div></div>
        <div className="stat"><div><strong>{all.reduce((a, m) => a + Number(m.units), 0)}</strong><span>{t('lab.units')}</span></div></div>
        <div className="stat"><div><strong>{money(total)}</strong><span>{t('lab.totalBilled')}</span></div></div>
        <div className="stat"><div><strong>{stillOut}</strong><span>{t('lab.stillOut')}</span></div></div>
      </div>

      <section className="panel">
        <h2>{t('lab.byMonth')}</h2>
        <p className="muted small">{t('lab.byMonthHint')}</p>
        {all.length === 0 && <p className="empty">{t('lab.noCases')}</p>}
        {all.length > 0 && (
          <div className="table-wrap">
            <table className="table table-compact">
              <thead><tr>
                <th>{t('lab.month')}</th>
                <th className="num">{t('lab.caseCount')}</th>
                <th className="num">{t('lab.units')}</th>
                <th className="num">{t('lab.expectedCost')}</th>
                <th className="num">{t('lab.stillOut')}</th>
                <th />
              </tr></thead>
              <tbody>
                {all.map((m) => (
                  <tr key={m.month}>
                    <td>{date(m.month)}</td>
                    <td className="num">{m.cases}</td>
                    <td className="num">{m.units}</td>
                    <td className="num"><strong>{money(m.expected)}</strong></td>
                    <td className={`num ${Number(m.still_out) > 0 ? 'warn-text' : 'muted'}`}>
                      {Number(m.still_out) || '—'}
                    </td>
                    <td>
                      <button className="link-btn" onClick={() => setOpen(open === m.month ? null : m.month)}>
                        {open === m.month ? t('common.close') : t('lab.showCases')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && (
        <section className="panel">
          <h2>{date(open)}</h2>
          {cases.isPending && <Skeleton rows={3} variant="list" />}
          {cases.isError && <ErrorNote error={cases.error} onRetry={() => cases.refetch()} />}
          {cases.data?.length === 0 && <p className="empty">{t('lab.noCases')}</p>}
          {cases.data && cases.data.length > 0 && <LabCaseList cases={cases.data} />}
        </section>
      )}
    </section>
  )
}
