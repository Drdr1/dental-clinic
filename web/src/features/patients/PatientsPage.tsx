import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { useDebounced } from '../../lib/useDebounced'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { searchMyPatients, searchPatients } from './api'
import { PatientForm } from './PatientForm'

export function PatientsPage() {
  const { clinicId, role, userId } = useMember()
  const { t, money } = useI18n()
  const [search, setSearch] = useState('')
  const [addingHere, setAdding] = useState(false)
  // The top bar's "new patient" button lands here with ?new=1.
  const [params, setParams] = useSearchParams()
  const adding = addingHere || params.get('new') === '1'
  const closeForm = () => { setAdding(false); if (params.has('new')) setParams({}, { replace: true }) }
  const [showArchived, setShowArchived] = useState(false)
  const q = useDebounced(search)

  const patients = useQuery({
    queryKey: ['patients', clinicId, q, showArchived, role],
    // Doctors see only their own patients; owner and reception see everyone.
    queryFn: () => (role === 'doctor'
      ? searchMyPatients(clinicId, userId, q)
      : searchPatients(clinicId, q, showArchived)),
    placeholderData: keepPreviousData,
  })

  return (
    <section className="page">
      <header className="page-head">
        <h1>{t('patients.title')}</h1>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>{t('patients.add')}</button>
      </header>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          autoFocus
          placeholder={t('patients.search')}
          aria-label={t('patients.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {role !== 'doctor' && <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          <span>{t('archive.show')}</span>
        </label>}
      </div>

      {patients.isError && <ErrorNote error={patients.error} onRetry={() => patients.refetch()} />}
      {patients.isPending && <Skeleton rows={5} variant="table" />}

      {patients.data && patients.data.length === 0 && (
        <p className="empty">{q.trim() ? t('patients.noResults', { q: q.trim() }) : t('patients.empty')}</p>
      )}

      {patients.data && patients.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('patients.col.name')}</th>
                <th>{t('patients.col.phone')}</th>
                <th className="num">{t('patients.col.balance')}</th>
                <th>{t('patients.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {patients.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/patients/${p.id}`} className="row-link">{p.full_name}</Link>
                    {p.archived_at && <span className="badge badge-muted"> {t('archive.badge')}</span>}
                    {p.medical_alerts && (
                      <span className="alert-dot" title={p.medical_alerts} aria-label={t('patients.alert')} />
                    )}
                  </td>
                  <td dir="ltr" className="phone">{p.phone}</td>
                  <td className="num">{p.outstanding > 0 ? money(p.outstanding) : t('common.none')}</td>
                  <td>
                    {p.overdueCount > 0 ? (
                      <span className="badge badge-danger">{t('patients.overdue', { n: p.overdueCount })}</span>
                    ) : p.outstanding > 0 ? (
                      <span className="badge badge-ok">{t('patients.upToDate')}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && <PatientForm onClose={closeForm} />}
    </section>
  )
}
