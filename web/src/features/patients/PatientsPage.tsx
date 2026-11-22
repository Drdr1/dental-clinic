import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { useDebounced } from '../../lib/useDebounced'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { Icon } from '../../components/Icon'
import { getClinicDoctors } from '../appointments/api'
import {
  listPatients, PAGE_SIZE, patientCounts, searchMyPatients,
  type ListedPatient, type PatientFilter,
} from './api'
import { PatientForm } from './PatientForm'

const FILTERS: PatientFilter[] = ['all', 'overdue', 'alerts', 'new', 'recall']

function ageOf(dob: string | null) {
  if (!dob) return null
  const d = new Date(dob), now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--
  return age >= 0 && age < 130 ? age : null
}
const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

export function PatientsPage() {
  const { clinicId, role, userId } = useMember()
  const { t, money, date, time } = useI18n()
  const navigate = useNavigate()
  const isDoctor = role === 'doctor'
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<PatientFilter>('all')
  const [page, setPage] = useState(0)
  const [showArchived, setShowArchived] = useState(false)
  // ?new=1 from the top bar's "مريض جديد" opens the form straight away.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (!params.get('new')) return
    setAdding(true)
    setParams({}, { replace: true })
  }, [params, setParams])
  const q = useDebounced(search)
  useEffect(() => { setPage(0) }, [q, filter, showArchived])

  const list = useQuery({
    queryKey: ['patients', clinicId, q, filter, showArchived, page, role],
    // Doctors see only their own patients; owner and reception see everyone.
    queryFn: async (): Promise<{ rows: ListedPatient[]; total: number }> => {
      if (!isDoctor) return listPatients(clinicId, { q, filter, archived: showArchived, page })
      const mine = await searchMyPatients(clinicId, userId, q)
      return {
        total: mine.length,
        rows: mine.map((p) => ({ ...p, date_of_birth: null, primary_doctor_id: userId, created_at: '', lastVisit: null, nextAppointment: null })),
      }
    },
    placeholderData: keepPreviousData,
  })
  const counts = useQuery({ queryKey: ['patient-counts', clinicId], queryFn: () => patientCounts(clinicId), enabled: !isDoctor })
  const doctors = useQuery({ queryKey: ['clinic-doctors', clinicId], queryFn: () => getClinicDoctors(clinicId), enabled: !isDoctor })
  const doctorName = new Map((doctors.data ?? []).map((d) => [d.user_id, d.display_name]))

  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  async function exportCsv() {
    // Everything matching the current filter, not just this page. A BOM so Excel reads the Arabic.
    const all = await listPatients(clinicId, { q, filter, archived: showArchived, page: 0, pageSize: 5000 })
    const head = [t('patients.col.patient'), t('patients.col.phone'), t('doc.doctor'), t('patients.col.lastVisit'), t('patients.col.next'), t('patients.col.balance')]
    const cell = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = all.rows.map((p) => [
      p.full_name, p.phone, (p.primary_doctor_id && doctorName.get(p.primary_doctor_id)) || '',
      p.lastVisit ? p.lastVisit.slice(0, 10) : '', p.nextAppointment ? p.nextAppointment.slice(0, 16).replace('T', ' ') : '',
      p.outstanding,
    ].map(cell).join(','))
    const blob = new Blob(['﻿' + [head.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `patients-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{t('patients.title')}</h1>
          {counts.data && <p className="muted">{t('patients.subtitle', { n: counts.data.all, fresh: counts.data.new })}</p>}
        </div>
        <div className="row-buttons">
          {!isDoctor && <button className="btn" onClick={exportCsv}>{t('patients.export')}</button>}
          <button className="btn btn-primary" onClick={() => setAdding(true)}>{t('patients.add')}</button>
        </div>
      </header>

      <section className="panel list-panel">
        <div className="list-tools">
          <label className="search-box">
            <Icon name="search" />
            <input type="search" placeholder={t('patients.filterList')} aria-label={t('patients.filterList')}
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {!isDoctor && (
            <div className="chips">
              {FILTERS.map((f) => (
                <button key={f} className={`chip chip-lg${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
                  {t(`patients.filter.${f}`)}{counts.data ? ` ${counts.data[f]}` : ''}
                </button>
              ))}
              <label className="check small">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                <span>{t('archive.show')}</span>
              </label>
            </div>
          )}
        </div>

        {list.isError && <ErrorNote error={list.error} onRetry={() => list.refetch()} />}
        {list.isPending && <Skeleton rows={6} variant="table" />}
        {list.data && list.data.rows.length === 0 && (
          <p className="empty">{q.trim() ? t('patients.noResults', { q: q.trim() }) : filter === 'all' ? t('patients.empty') : t('patients.noneInFilter')}</p>
        )}

        {list.data && list.data.rows.length > 0 && (
          <div className="table-scroll">
            <table className="table table-plain">
              <thead>
                <tr>
                  <th>{t('patients.col.patient')}</th>
                  <th className="hide-phone">{t('patients.col.phone')}</th>
                  {!isDoctor && <th className="hide-phone">{t('doc.doctor')}</th>}
                  {!isDoctor && <th className="hide-phone">{t('patients.col.lastVisit')}</th>}
                  {!isDoctor && <th className="hide-phone">{t('patients.col.next')}</th>}
                  <th>{t('patients.col.owed')}</th>
                  <th>{t('patients.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((p) => {
                  const age = ageOf(p.date_of_birth)
                  return (
                    <tr key={p.id} className="click-row" onClick={(e) => {
                      if ((e.target as Element).closest('a')) return
                      navigate(`/patients/${p.id}`)
                    }}>
                      <td>
                        <div className="who">
                          <div>
                            <Link to={`/patients/${p.id}`} className="row-link strong">{p.full_name}</Link>
                            {age !== null && <p className="muted small">{t('patients.age', { n: age })}</p>}
                          </div>
                          {p.medical_alerts && <span className="badge badge-alert" title={p.medical_alerts}>{p.medical_alerts}</span>}
                          {p.archived_at && <span className="badge badge-muted">{t('archive.badge')}</span>}
                        </div>
                      </td>
                      <td dir="ltr" className="phone hide-phone">{p.phone}</td>
                      {!isDoctor && <td className="hide-phone">{(p.primary_doctor_id && doctorName.get(p.primary_doctor_id)) || <span className="muted">—</span>}</td>}
                      {!isDoctor && <td className="nowrap hide-phone">{p.lastVisit ? (sameDay(p.lastVisit) ? t('today.today') : date(p.lastVisit)) : <span className="muted">{t('patients.newPatient')}</span>}</td>}
                      {!isDoctor && (
                        <td className="nowrap hide-phone">
                          {p.nextAppointment
                            ? sameDay(p.nextAppointment)
                              ? <span className="next-today">{t('today.today')} {time(p.nextAppointment)}</span>
                              : date(p.nextAppointment)
                            : <span className="muted">—</span>}
                        </td>
                      )}
                      <td className="strong nowrap">{p.outstanding > 0 ? money(p.outstanding) : <span className="muted">—</span>}</td>
                      <td>
                        {p.overdueCount > 0
                          ? <span className="badge badge-danger">{t('patients.overdue', { n: p.overdueCount })}</span>
                          : p.created_at && Date.now() - Date.parse(p.created_at) < 30 * 86_400_000 && !p.lastVisit
                            ? <span className="badge badge-info">{t('patients.newBadge')}</span>
                            : <span className="badge badge-neutral">{t('patients.upToDate')}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {list.data && total > 0 && !isDoctor && (
          <div className="pager">
            <span className="muted small">
              {t('patients.showing', { from: page * PAGE_SIZE + 1, to: Math.min(total, (page + 1) * PAGE_SIZE), total })}
            </span>
            <div className="row-buttons">
              <button className="btn btn-small" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('patients.prev')}</button>
              <button className="btn btn-small" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('patients.next')}</button>
            </div>
          </div>
        )}
      </section>

      {adding && <PatientForm onClose={() => setAdding(false)} />}
    </section>
  )
}
