import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { PatientPicker, type PickedPatient } from '../../components/PatientPicker'
import { getClinicCalendar, getPatientDoctor, getPatientPlans, saveAppointment, type DayAppointment, getClinicDoctors } from './api'
import { localDateOf, localToIso, minutesOfDay, minutesToTime, timeToMinutes } from './time'

const DURATIONS = [15, 30, 45, 60, 90, 120]

type Props = {
  onClose: () => void
  /** Editing / rescheduling an existing appointment. */
  appointment?: DayAppointment
  /** Defaults for a new appointment (from a calendar slot or a patient file). */
  initial?: { date?: string; time?: string; chairId?: string; patient?: PickedPatient; planId?: string }
}

export function AppointmentDialog({ onClose, appointment, initial }: Props) {
  const { clinicId, userId, role } = useMember()
  const { t, time: clock } = useI18n()
  const queryClient = useQueryClient()
  const calendar = useQuery({ queryKey: ['calendar', clinicId], queryFn: () => getClinicCalendar(clinicId) })

  const [patient, setPatient] = useState<PickedPatient | null>(
    appointment
      ? { id: appointment.patient_id, full_name: appointment.patientName, phone: appointment.patientPhone, medical_alerts: appointment.alerts }
      : initial?.patient ?? null,
  )
  const [planId, setPlanId] = useState(appointment?.treatment_plan_id ?? initial?.planId ?? '')
  const [chairId, setChairId] = useState(appointment?.chair_id ?? initial?.chairId ?? '')
  const [doctorId, setDoctorId] = useState(appointment?.doctor_id ?? (role === 'doctor' ? userId : ''))
  const [date, setDate] = useState(appointment ? localDateOf(appointment.starts_at) : initial?.date ?? '')
  const [time, setTime] = useState(appointment ? minutesToTime(minutesOfDay(appointment.starts_at)) : initial?.time ?? '')
  const [duration, setDuration] = useState(
    appointment ? Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60000) : 30,
  )
  const [notes, setNotes] = useState(appointment?.notes ?? '')

  // Reception rarely books "for nobody": fall back to the patient's own doctor.
  const patientDoctor = useQuery({
    queryKey: ['patient-doctor', patient?.id],
    queryFn: () => getPatientDoctor(patient!.id),
    enabled: !!patient && !appointment,
  })
  useEffect(() => {
    if (!doctorId && patientDoctor.data) setDoctorId(patientDoctor.data)
  }, [patientDoctor.data, doctorId])

  const plans = useQuery({
    queryKey: ['patient-plans', patient?.id],
    queryFn: () => getPatientPlans(patient!.id),
    enabled: !!patient,
  })

  const chairs = calendar.data?.chairs ?? []
  const doctors = useQuery({ queryKey: ['clinic-doctors', clinicId], queryFn: () => getClinicDoctors(clinicId) })
  const effectiveChair = chairId || chairs[0]?.id || ''
  const slots = useMemo(() => {
    if (!calendar.data) return []
    const { opens_at, closes_at, slot_minutes } = calendar.data.hours
    const out: string[] = []
    for (let m = timeToMinutes(opens_at); m < timeToMinutes(closes_at); m += slot_minutes) out.push(minutesToTime(m))
    return out
  }, [calendar.data])

  // Every appointment belongs to a doctor: that is what puts it on his calendar,
  // and what decides whose collections and lab bills it counts towards.
  const needsDoctor = (doctors.data?.length ?? 0) > 0
  const valid = !!patient && !!effectiveChair && !!date && !!time && duration > 0 &&
    (!needsDoctor || !!doctorId)

  const save = useMutation({
    mutationFn: () => {
      const startsAt = localToIso(date, time)
      const endsAt = new Date(Date.parse(startsAt) + duration * 60000).toISOString()
      return saveAppointment(
        { clinicId, patientId: patient!.id, chairId: effectiveChair,
        doctorId: doctorId || null, planId: planId || null, startsAt, endsAt, notes },
        appointment?.id,
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['day'] })
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['today'] })
      onClose()
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (valid && !save.isPending) save.mutate()
  }

  return (
    <Modal title={appointment ? t('appt.edit') : t('appt.new')} onClose={onClose}>
      <form onSubmit={onSubmit} className="dialog-form">
        <div className="field">
          <span>{t('appt.patient')}</span>
          {appointment
            ? <div className="picked"><strong>{appointment.patientName}</strong></div>
            : <PatientPicker value={patient} onChange={(p) => { setPatient(p); setPlanId('') }} />}
        </div>

        {patient?.medical_alerts && (
          <div className="medical-alert compact" role="note">
            <strong>{t('patient.alertTitle')}</strong>
            <p>{patient.medical_alerts}</p>
          </div>
        )}

        {patient && (plans.data?.length ?? 0) > 0 && (
          <label className="field">
            <span>{t('appt.plan')}</span>
            <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">{t('appt.noPlan')}</option>
              {plans.data!.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
        )}

        <div className="field-row">
          <label className="field">
            <span>{t('appt.date')}</span>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('appt.time')}</span>
            <select required value={time} onChange={(e) => setTime(e.target.value)}>
              <option value="" disabled>{t('appt.chooseTime')}</option>
              {slots.map((s) => <option key={s} value={s}>{clock(s)}</option>)}
            </select>
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>{t('appt.duration')}</span>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => <option key={d} value={d}>{t('appt.minutes', { n: d })}</option>)}
            </select>
          </label>
          {(doctors.data?.length ?? 0) > 0 && (
            <label className="field">
              <span>{t('doc.doctor')}</span>
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="" disabled>{t('doc.pick')}</option>
                {doctors.data!.map((d) => <option key={d.user_id} value={d.user_id}>{d.display_name}</option>)}
              </select>
            </label>
          )}
          {chairs.length > 1 && (
            <label className="field">
              <span>{t('appt.chair')}</span>
              <select value={effectiveChair} onChange={(e) => setChairId(e.target.value)}>
                {chairs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
        </div>

        <label className="field">
          <span>{t('appt.notes')}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder={t('appt.notesHint')} />
        </label>

        {save.isError && <ErrorNote error={save.error} />}

        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={!valid || save.isPending}>
            {save.isPending ? t('common.saving') : t('appt.save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}
