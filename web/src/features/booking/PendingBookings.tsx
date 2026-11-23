import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { templates, waMessage } from '../../lib/whatsapp'
import { assignDoctor, getClinicDoctors } from '../appointments/api'
import { confirmBooking, getPendingBookings } from './api'

/** Online bookings waiting for reception to call and confirm. */
export function PendingBookings() {
  const { clinicId, clinicName } = useMember()
  const { t, date } = useI18n()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['pending-bookings', clinicId], queryFn: () => getPendingBookings(clinicId) })
  const doctors = useQuery({ queryKey: ['clinic-doctors', clinicId], queryFn: () => getClinicDoctors(clinicId) })
  // A booking made online names no doctor, so reception says who is taking it.
  const [picked, setPicked] = useState<Record<string, string>>({})
  const confirm = useMutation({
    mutationFn: async (id: string) => {
      const doctorId = picked[id]
      if (doctorId) await assignDoctor(id, doctorId)
      await confirmBooking(id)
    },
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
        <h2>{t('book.pendingTitle')}</h2>
        <span className="pill">{t('book.pendingNew', { n: q.data.length })}</span>
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
              {(doctors.data?.length ?? 0) > 0 && (
                <select className="cell-select" aria-label={t('doc.doctor')}
                  value={picked[b.id] ?? ''}
                  onChange={(e) => setPicked({ ...picked, [b.id]: e.target.value })}>
                  <option value="" disabled>{t('doc.pick')}</option>
                  {doctors.data!.map((d) => <option key={d.user_id} value={d.user_id}>{d.display_name}</option>)}
                </select>
              )}
              <button className="btn btn-small btn-ink"
                disabled={confirm.isPending || ((doctors.data?.length ?? 0) > 0 && !picked[b.id])}
                onClick={() => confirm.mutate(b.id)}>{t('book.confirm')}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
