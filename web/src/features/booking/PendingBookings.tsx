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
  const { t, date, time } = useI18n()
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
        <h2>{t('book.pendingShort')}</h2>
        <span className="badge badge-new">{t('book.newCount', { n: q.data.length })}</span>
      </div>
      {confirm.isError && <ErrorNote error={confirm.error} />}
      <ul className="work-list bookings">
        {q.data.map((b) => (
          <li key={b.id}>
            <div>
              <Link to={`/patients/${b.patient_id}`} className="row-link strong">{b.full_name}</Link>
              <p className="muted">
                {[b.service_name, date(b.starts_at), time(b.starts_at)].filter(Boolean).join(' · ')}
              </p>
              {b.notes && <p className="muted small">{b.notes}</p>}
            </div>
            <div className="booking-actions">
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
              <a className="btn btn-small" target="_blank" rel="noreferrer"
                href={waMessage(b.whatsapp_phone ?? b.phone, templates.appointment({
                  clinic: clinicName, name: b.full_name, startsAt: b.starts_at,
                }))}
                aria-label={t('appt.confirmWhatsapp')} title={t('appt.confirmWhatsapp')}>
                {t('book.whatsapp')}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
