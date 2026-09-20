import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { getCases, type LabFilter } from './api'
import { LabCaseDialog } from './LabCaseDialog'
import { LabCaseList } from './LabCaseList'

const FILTERS: LabFilter[] = ['open', 'received', 'done']

export function LabsPage() {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const [filter, setFilter] = useState<LabFilter>('open')
  const [adding, setAdding] = useState(false)
  const q = useQuery({ queryKey: ['lab-cases', clinicId, filter], queryFn: () => getCases(clinicId, filter) })

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

      {adding && <LabCaseDialog onClose={() => setAdding(false)} />}
    </section>
  )
}
