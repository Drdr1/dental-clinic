import { Link } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { templates, waMessage } from '../../lib/whatsapp'
import { setAppointmentStatus, type AppointmentStatus, type DayAppointment } from './api'
import { apptStatusKey } from './labels'

type Props = { appointment: DayAppointment; onClose: () => void; onEdit: () => void }

// What reception can do next from each status.
const NEXT: Record<string, AppointmentStatus[]> = {
  booked: ['arrived', 'no_show', 'cancelled'],
  arrived: ['in_session', 'done', 'booked'],
  in_session: ['done', 'arrived'],
  done: ['in_session'],
  no_show: ['booked'],
}

export function AppointmentDetails({ appointment: a, onClose, onEdit }: Props) {
  const { clinicName } = useMember()
  const { t, lang } = useI18n()
  const queryClient = useQueryClient()
  const fmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  })

  const status = useMutation({
    mutationFn: (s: AppointmentStatus) => setAppointmentStatus(a.id, s),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['day'] })
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['today'] })
      onClose()
    },
  })

  return (
    <Modal title={a.patientName} onClose={onClose}>
      <div className="dialog-form">
        <p className="appt-when">{fmt.format(new Date(a.starts_at))}</p>
        <p><span className={`badge appt-badge appt-${a.status}`}>{t(apptStatusKey(a.status))}</span></p>

        {a.alerts && (
          <div className="medical-alert compact" role="note">
            <strong>{t('patient.alertTitle')}</strong>
            <p>{a.alerts}</p>
          </div>
        )}
        {a.planTitle && a.treatment_plan_id && (
          <p>{t('appt.plan')}: <Link to={`/plans/${a.treatment_plan_id}`}>{a.planTitle}</Link></p>
        )}
        {a.notes && <p className="muted">{a.notes}</p>}

        <div className="status-actions">
          {(NEXT[a.status] ?? []).map((s, i) => (
            <button key={s} className={`btn ${i === 0 ? 'btn-primary' : ''}`}
              disabled={status.isPending} onClick={() => status.mutate(s)}>
              {t(`appt.to.${s}` as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
        {status.isError && <ErrorNote error={status.error} />}

        <div className="row-actions">
          <span className="head-actions">
            <Link className="btn btn-small" to={`/patients/${a.patient_id}`}>{t('appt.openFile')}</Link>
            {a.status === 'booked' && <button className="btn btn-small" onClick={onEdit}>{t('appt.reschedule')}</button>}
            {a.patientPhone && a.status === 'booked' && (
              <a className="btn btn-small" target="_blank" rel="noreferrer"
                href={waMessage(a.patientPhone, templates.appointment({ name: a.patientName, clinic: clinicName, startsAt: a.starts_at }))}>
                {t('appt.confirmWhatsapp')}
              </a>
            )}
            {/* Leaving the sheet comes last, under everything it could be mistaken for. */}
            <button className="btn btn-small" onClick={onClose}>{t('common.close')}</button>
          </span>
        </div>
      </div>
    </Modal>
  )
}
