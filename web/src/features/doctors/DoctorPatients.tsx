import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'

type Row = {
  patient_id: string; full_name: string; phone: string
  assigned: boolean; sessions: number; last_visit: string | null; outstanding: number
}

async function getDoctorPatients(clinicId: string, doctorId: string): Promise<Row[]> {
  const { data, error } = await supabase.rpc('doctor_patients', { p_clinic: clinicId, p_doctor: doctorId })
  if (error) throw error
  return (data ?? []) as Row[]
}

/** Patients following this doctor, or treated by them. */
export function DoctorPatients({ doctorId }: { doctorId: string }) {
  const { clinicId } = useMember()
  const { t, money, date } = useI18n()
  const q = useQuery({ queryKey: ['doctor-patients', clinicId, doctorId], queryFn: () => getDoctorPatients(clinicId, doctorId) })

  return (
    <section className="panel panel-wide">
      <h2>{t('doc.patientsTitle', { n: q.data?.length ?? 0 })}</h2>
      {q.isPending && <Skeleton rows={3} variant="table" />}
      {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <p className="muted">{t('doc.noPatients')}</p>}
      {q.data && q.data.length > 0 && (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>{t('patients.col.name')}</th>
                <th className="num">{t('doc.sessions')}</th>
                <th>{t('doc.lastVisit')}</th>
                <th className="num">{t('patient.outstanding')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.patient_id}>
                  <td>
                    <Link to={`/patients/${p.patient_id}`} className="row-link strong">{p.full_name}</Link>
                    {p.assigned && <span className="badge badge-ok"> {t('doc.assigned')}</span>}
                    <p className="muted small" dir="ltr">{p.phone}</p>
                  </td>
                  <td className="num">{p.sessions}</td>
                  <td className="muted">{p.last_visit ? date(p.last_visit) : '—'}</td>
                  <td className={`num ${p.outstanding > 0 ? 'danger-text' : 'muted'}`}>
                    {p.outstanding > 0 ? money(p.outstanding) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
