import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import type { MessageKey } from '../../i18n/en'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { Icon } from '../../components/Icon'
import { monthRange } from './range'
import { getAttribution, getDoctors, type Doctor } from './api'
import { PayoutDialog } from './DoctorDialogs'
import { getSettings, getTeam, updateMember } from '../settings/api'
import { AddStaffDialog, PasswordDialog } from '../settings/TeamSection'

const BASIS: Record<string, MessageKey> = {
  work: 'doc.basis.work', collection: 'doc.basis.collection', net_lab: 'doc.basis.net_lab', clinic_income: 'doc.basis.clinic_income',
}

/** Doctors as cards with this month's numbers, and the reception team under them. */
export function DoctorsPage() {
  const { clinicId, role, userId } = useMember()
  const { t, money } = useI18n()
  const qc = useQueryClient()
  const owner = role === 'owner'
  const range = monthRange(0)
  const [adding, setAdding] = useState<null | 'doctor' | 'receptionist'>(null)
  const [paying, setPaying] = useState<Doctor | null>(null)
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null)
  const q = useQuery({ queryKey: ['doctors', clinicId, range], queryFn: () => getDoctors(clinicId, range.from, range.to), enabled: owner })
  const team = useQuery({ queryKey: ['team', clinicId], queryFn: () => getTeam(clinicId), enabled: owner })
  const settings = useQuery({ queryKey: ['settings', clinicId], queryFn: () => getSettings(clinicId), enabled: owner, select: (d) => d.clinic })
  // Income against what reached a doctor: if these differ, some patient has no doctor.
  const check = useQuery({
    queryKey: ['doctor-attribution', clinicId, range],
    queryFn: () => getAttribution(clinicId, range.from, range.to), enabled: owner,
  })
  const toggle = useMutation({
    mutationFn: (a: { userId: string; active: boolean }) => updateMember(clinicId, a.userId, { active: a.active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team'] }); qc.invalidateQueries({ queryKey: ['doctors'] }) },
  })

  if (!owner) return <section className="page"><p className="empty">{t('doc.ownerOnly')}</p></section>

  const doctors = (q.data ?? []).filter((d) => d.role !== 'receptionist')
  const reception = (team.data ?? []).filter((m) => m.role === 'receptionist')
  const basis = BASIS[settings.data?.commission_basis ?? 'work'] ?? BASIS.work

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{t('doc.titleV2')}</h1>
          <p className="muted">{t('doc.teamCount', { d: doctors.filter((d) => d.active).length, r: reception.filter((m) => m.active).length })}</p>
        </div>
        <div className="row-buttons">
          <button className="btn" onClick={() => setAdding('receptionist')}>{t('doc.addReception')}</button>
          <button className="btn btn-primary" onClick={() => setAdding('doctor')}>{t('doc.addDoctor')}</button>
        </div>
      </header>

      {q.isPending && <Skeleton rows={3} variant="cards" />}
      {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data && doctors.length === 0 && <p className="empty">{t('doc.empty')}</p>}

      <div className="doc-cards">
        {doctors.map((d) => {
          // Everything earned less everything paid: what the clinic owes today.
          const balance = Math.round((d.earned_all_time - d.paid_all_time) * 100) / 100
          const sub = [d.specialty, d.role === 'owner' ? t('doc.isOwner') : null,
            d.work_days?.length ? (d.work_days.length >= 6 ? t('doc.everyDay') : t('doc.daysAWeek', { n: d.work_days.length })) : null].filter(Boolean).join(' · ')
          return (
            <article key={d.user_id} className={`panel doc-card${d.active ? '' : ' is-inactive'}`}>
              <div className="doc-top">
                <span className="user-avatar"><Icon name="patients" /></span>
                <div>
                  <Link to={`/doctors/${d.user_id}`} className="row-link strong">{d.display_name}</Link>
                  <p className="muted small">{sub || t('doc.noSpecialty')}</p>
                </div>
                {!d.active && <span className="badge badge-muted">{t('team.inactive')}</span>}
              </div>
              <span className="pill doc-pill">{t('doc.percentOf', { p: d.percent, basis: t(basis) })}</span>
              <dl className="doc-stats">
                <div><dt>{t('doc.patientsN')}</dt><dd>{d.patients}</dd></div>
                <div><dt>{t('doc.monthSessions')}</dt><dd>{d.sessions}</dd></div>
                <div><dt>{t('doc.work')}</dt><dd>{money(d.work_value)}</dd></div>
              </dl>
              <div className="doc-money">
                <div><span>{t('doc.shareThisMonth')}</span><strong>{money(d.earned)}</strong></div>
                <div><span>{t('doc.owedToHim')}</span><strong className={balance > 0 ? '' : 'muted'}>{money(Math.max(0, balance))}</strong></div>
              </div>
              <div className="row-buttons">
                <button className="btn btn-small btn-ink" disabled={balance <= 0} onClick={() => setPaying(d)}>{t('doc.payDue')}</button>
                <Link className="btn btn-small" to={`/doctors/${d.user_id}`}>{t('doc.statement')}</Link>
              </div>
            </article>
          )
        })}
      </div>

      {check.data && check.data.unattributed > 0 && (
        <p className="warn-text small">
          {t('doc.unattributed', { amount: money(check.data.unattributed), n: check.data.orphan_payments })}
        </p>
      )}

      <section className="panel">
        <h2>{t('doc.reception')}</h2>
        {team.isError && <ErrorNote error={team.error} onRetry={() => team.refetch()} />}
        {toggle.isError && <ErrorNote error={toggle.error} />}
        {team.data && reception.length === 0 && <p className="muted">{t('doc.noReception')}</p>}
        {reception.length > 0 && (
          <div className="table-scroll">
            <table className="table table-plain">
              <thead><tr><th>{t('team.name')}</th><th>{t('team.role')}</th><th className="hide-phone">{t('doc.login')}</th><th /></tr></thead>
              <tbody>
                {reception.map((m) => (
                  <tr key={m.user_id} className={m.active ? '' : 'is-inactive'}>
                    <td className="strong">{m.display_name}</td>
                    <td>{t('role.receptionist')}{!m.active && <span className="badge badge-muted"> {t('team.inactive')}</span>}</td>
                    <td className="hide-phone" dir="ltr">{m.email}</td>
                    <td>
                      <div className="mat-actions">
                        <button className="btn btn-small" onClick={() => setResetting({ id: m.user_id, name: m.display_name })}>{t('doc.changePassword')}</button>
                        {m.user_id !== userId && (
                          <button className={`btn btn-small${m.active ? ' btn-danger-line' : ''}`} disabled={toggle.isPending}
                            onClick={() => toggle.mutate({ userId: m.user_id, active: !m.active })}>
                            {m.active ? t('doc.suspend') : t('team.activate')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adding && <AddStaffDialog initialRole={adding} onClose={() => setAdding(null)} />}
      {paying && <PayoutDialog doctor={paying} range={range} onClose={() => setPaying(null)} />}
      {resetting && <PasswordDialog userId={resetting.id} name={resetting.name} onClose={() => setResetting(null)} />}
    </section>
  )
}
