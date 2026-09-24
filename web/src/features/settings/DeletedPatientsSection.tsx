import { useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { getDeletedPatients } from '../patients/api'

/** Owner-only record of who was deleted, what they had, and why. */
export function DeletedPatientsSection() {
  const { clinicId, role } = useMember()
  const { t, date } = useI18n()
  const q = useQuery({ queryKey: ['deleted-patients', clinicId], queryFn: () => getDeletedPatients(clinicId), enabled: role === 'owner' })
  if (role !== 'owner' || !q.data?.length) return null

  return (
    <section className="panel">
      <h2>{t('archive.deletedLog')}</h2>
      <p className="muted">{t('archive.deletedLogHint')}</p>
      {q.isError && <ErrorNote error={q.error} />}
      <div className="table-wrap">
        <table className="table table-compact">
          <thead><tr>
            <th>{t('patientForm.fullName')}</th><th>{t('patientForm.phone')}</th>
            <th>{t('archive.had')}</th><th>{t('archive.reason')}</th><th>{t('receipt.date')}</th>
          </tr></thead>
          <tbody>
            {q.data.map((d) => (
              <tr key={d.id}>
                <td>{d.full_name}</td>
                <td dir="ltr">{d.phone}</td>
                <td className="muted">
                  {Object.entries(d.counts).filter(([, v]) => v > 0)
                    .map(([k, v]) => `${t(`archive.rec.${k}` as Parameters<typeof t>[0])}: ${v}`).join('، ') || '—'}
                </td>
                <td className="muted">{d.reason}</td>
                <td className="muted">{date(d.deleted_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
