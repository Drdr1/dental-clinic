import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { methodKey } from '../payments/labels'
import { monthRange } from './range'
import { getDoctors, getPayouts } from './api'
import { PayoutDialog, ProfileDialog } from './DoctorDialogs'

export function DoctorPage() {
  const { id = '' } = useParams()
  const { clinicId, role } = useMember()
  const { t, money, date } = useI18n()
  const [preset, setPreset] = useState<'this' | 'last'>('this')
  const [range, setRange] = useState(() => monthRange(0))
  const [dialog, setDialog] = useState<'profile' | 'pay' | null>(null)
  const owner = role === 'owner'

  const q = useQuery({ queryKey: ['doctors', clinicId, range], queryFn: () => getDoctors(clinicId, range.from, range.to), enabled: owner })
  const payouts = useQuery({ queryKey: ['payouts', id], queryFn: () => getPayouts(clinicId, id), enabled: owner })

  if (!owner) return <section className="page"><p className="empty">{t('doc.ownerOnly')}</p></section>
  if (q.isPending) return <section className="page"><Skeleton rows={3} variant="cards" /></section>
  if (q.isError) return <section className="page"><ErrorNote error={q.error} onRetry={() => q.refetch()} /></section>

  const d = q.data?.find((x) => x.user_id === id)
  if (!d) return <section className="page"><p className="empty">{t('doc.notFound')}</p></section>

  const balance = Math.round((d.earned - d.paid_all_time) * 100) / 100
  const pick = (p: 'this' | 'last') => { setPreset(p); setRange(monthRange(p === 'this' ? 0 : -1)) }
  const days = (d.work_days ?? []).map((x) => t(`day.${x}` as Parameters<typeof t>[0])).join('، ')

  return (
    <section className="page">
      <Link to="/doctors" className="back-link">{t('common.back')}</Link>

      <header className="page-head">
        <div>
          <h1>{d.display_name}</h1>
          <p className="muted">
            {d.specialty || t('doc.noSpecialty')}
            {d.registration_no && ` · ${t('doc.registration')}: ${d.registration_no}`}
            {d.phone && ` · ${d.phone}`}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setDialog('profile')}>{t('doc.editProfile')}</button>
          <Link className="btn" to={`/appointments?doctor=${d.user_id}`}>{t('doc.schedule')}</Link>
          <button className="btn btn-primary" onClick={() => setDialog('pay')}>{t('doc.pay')}</button>
        </div>
      </header>

      <div className="info-bar">
        <span><em>{t('doc.workDays')}</em>{days || t('doc.noDays')}</span>
        {d.works_from && d.works_to && (
          <span><em>{t('doc.hours')}</em>{d.works_from.slice(0, 5)} – {d.works_to.slice(0, 5)}</span>
        )}
        <span className={balance > 0 ? 'is-danger' : ''}><em>{t('doc.balance')}</em>{money(balance)}</span>
      </div>

      <div className="toolbar">
        <div className="segmented">
          <button className={preset === 'this' ? 'is-active' : ''} onClick={() => pick('this')}>{t('fin.thisMonth')}</button>
          <button className={preset === 'last' ? 'is-active' : ''} onClick={() => pick('last')}>{t('fin.lastMonth')}</button>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat"><div><strong>{d.sessions}</strong><span>{t('doc.sessions')}</span></div></div>
        <div className="stat"><div><strong>{d.patients}</strong><span>{t('doc.patients')}</span></div></div>
        <div className="stat"><div><strong>{d.appointments}</strong><span>{t('doc.appointments')}</span></div></div>
        <div className="stat"><div><strong>{money(d.work_value)}</strong><span>{t('doc.workValue')}</span></div></div>
      </div>

      <div className="patient-grid">
        <section className="panel">
          <h2>{t('doc.money')}</h2>
          <dl className="totals wide">
            <div><dt>{t('doc.earned', { percent: d.percent })}</dt><dd>{money(d.earned)}</dd></div>
            <div><dt>{t('doc.paidPeriod')}</dt><dd>{money(d.paid_in_period)}</dd></div>
            <div><dt>{t('doc.paidTotal')}</dt><dd>{money(d.paid_all_time)}</dd></div>
            <div className="totals-net"><dt>{t('doc.balance')}</dt><dd>{money(balance)}</dd></div>
          </dl>
        </section>

        <section className="panel">
          <h2>{t('doc.payoutHistory')}</h2>
          {payouts.data?.length === 0 && <p className="muted">{t('doc.noPayouts')}</p>}
          {payouts.data && payouts.data.length > 0 && (
            <table className="table table-compact">
              <tbody>
                {payouts.data.map((x) => (
                  <tr key={x.id}>
                    <td>{date(x.paid_on)}</td>
                    <td className="num">{money(x.amount)}</td>
                    <td className="muted">{t(methodKey(x.method))}</td>
                    <td className="muted">{x.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {dialog === 'profile' && <ProfileDialog doctor={d} onClose={() => setDialog(null)} />}
      {dialog === 'pay' && <PayoutDialog doctor={d} range={range} onClose={() => setDialog(null)} />}
    </section>
  )
}
