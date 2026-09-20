import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import type { PickedPatient } from '../../components/PatientPicker'
import { getUpcomingForPatient, type DayAppointment } from './api'
import { AppointmentDialog } from './AppointmentDialog'
import { AppointmentDetails } from './AppointmentDetails'
import { apptStatusKey } from './labels'

/** Upcoming appointments panel for the patient file. */
export function PatientAppointments({ patient }: { patient: PickedPatient }) {
  const { t, lang } = useI18n()
  const [booking, setBooking] = useState(false)
  const [details, setDetails] = useState<DayAppointment | null>(null)
  const [editing, setEditing] = useState<DayAppointment | null>(null)
  const q = useQuery({ queryKey: ['appointments', patient.id], queryFn: () => getUpcomingForPatient(patient.id) })
  const fmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('appt.upcoming')}</h2>
        <button className="btn" onClick={() => setBooking(true)}>{t('appt.book')}</button>
      </div>
      {q.data?.length === 0 && <p className="muted">{t('appt.noneUpcoming')}</p>}
      <ul className="plan-list">
        {q.data?.map((a) => (
          <li key={a.id}>
            <button type="button" className="appt-row" onClick={() => setDetails(a)}>
              <span>{fmt.format(new Date(a.starts_at))}</span>
              <span className={`badge appt-badge appt-${a.status}`}>{t(apptStatusKey(a.status))}</span>
            </button>
            {a.planTitle && <p className="plan-sub muted">{a.planTitle}</p>}
          </li>
        ))}
      </ul>
      {booking && <AppointmentDialog onClose={() => setBooking(false)} initial={{ patient }} />}
      {details && (
        <AppointmentDetails appointment={details} onClose={() => setDetails(null)}
          onEdit={() => { setEditing(details); setDetails(null) }} />
      )}
      {editing && <AppointmentDialog appointment={editing} onClose={() => setEditing(null)} />}
    </section>
  )
}
