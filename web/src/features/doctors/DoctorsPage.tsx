import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { monthRange } from './range'
import { getDoctors } from './api'

/** A plain list, like the patients page: scan, then open one. */
export function DoctorsPage() {
  const { clinicId, role } = useMember()
  const { t, money } = useI18n()
  const [preset, setPreset] = useState<'this' | 'last'>('this')
  const [range, setRange] = useState(() => monthRange(0))
  const owner = role === 'owner'
  const q = useQuery({ queryKey: ['doctors', clinicId, range], queryFn: () => getDoctors(clinicId, range.from, range.to), enabled: owner })

  if (!owner) return <section className="page"><p className="empty">{t('doc.ownerOnly')}</p></section>
  const pick = (p: 'this' | 'last') => { setPreset(p); setRange(monthRange(p === 'this' ? 0 : -1)) }

  return (
    <section className="page">
      <header className="page-head">
        <h1>{t('doc.title')}</h1>
        <div className="segmented">
          <button className={preset === 'this' ? 'is-active' : ''} onClick={() => pick('this')}>{t('fin.thisMonth')}</button>
          <button className={preset === 'last' ? 'is-active' : ''} onClick={() => pick('last')}>{t('fin.lastMonth')}</button>
        </div>
      </header>

      {q.isPending && <Skeleton rows={4} variant="table" />}
      {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <p className="empty">{t('doc.empty')}</p>}

      {q.data && q.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('team.name')}</th>
                <th className="num">{t('doc.sessions')}</th>
                <th className="num">{t('doc.workValue')}</th>
                <th className="num">{t('doc.commission')}</th>
                <th className="num">{t('doc.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((d) => {
                const balance = Math.round((d.earned - d.paid_all_time) * 100) / 100
                return (
                  <tr key={d.user_id} className={d.active ? '' : 'is-inactive'}>
                    <td>
                      <Link to={`/doctors/${d.user_id}`} className="row-link strong">{d.display_name}</Link>
                      {!d.active && <span className="badge badge-muted"> {t('team.inactive')}</span>}
                      <p className="muted small">{d.specialty || t('doc.noSpecialty')}</p>
                    </td>
                    <td className="num">{d.sessions}</td>
                    <td className="num">{money(d.work_value)}</td>
                    <td className="num">{money(d.earned)} <span className="muted">({d.percent}%)</span></td>
                    <td className={`num ${balance > 0 ? 'danger-text' : 'muted'}`}>
                      {balance === 0 ? '—' : money(balance)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
