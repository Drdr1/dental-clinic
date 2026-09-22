import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { templates, waMessage } from '../../lib/whatsapp'
import { confirmBooking, getPendingBookings } from './api'

/** Online bookings waiting for reception to call and confirm. */
export function PendingBookings() {
  const { clinicId, clinicName } = useMember()
  const { t, date } = useI18n()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['pending-bookings', clinicId], queryFn: () => getPendingBookings(clinicId) })
  const confirm = useMutation({
    mutationFn: confirmBooking,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-bookings'] })
      qc.invalidateQueries({ queryKey: ['today'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
  })

  if (!q.data?.length) return null

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('book.pendingTitle', { n: q.data.length })}</h2>
        <Link className="btn" to="/appointments">{t('today.openCalendar')}</Link>
      </div>
      {confirm.isError && <ErrorNote error={confirm.error} />}
      <ul className="work-list">
        {q.data.map((b) => (
          <li key={b.id}>
            <div>
              <Link to={`/patients/${b.patient_id}`} className="row-link strong">{b.full_name}</Link>
              <p className="muted">
                {date(b.starts_at)} · {new Date(b.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                {b.service_name && ` · ${b.service_name}`}
              </p>
              {b.notes && <p className="muted small">{b.notes}</p>}
            </div>
            <div className="work-meta">
              <a className="btn btn-small" href={`tel:${b.phone}`}>{t('patient.call')}</a>
              <a className="btn btn-small" target="_blank" rel="noreferrer"
                href={waMessage(b.whatsapp_phone ?? b.phone, templates.appointment({
                  clinic: clinicName, name: b.full_name, startsAt: b.starts_at,
                }))}>
                {t('appt.confirmWhatsapp')}
              </a>
              <button className="btn btn-small btn-primary" disabled={confirm.isPending}
                onClick={() => confirm.mutate(b.id)}>{t('book.confirm')}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
