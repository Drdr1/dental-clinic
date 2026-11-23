import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFeature, useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { isValidPhone, normalizePhone } from '../../lib/phone'
import { todayLocal } from '../../lib/dates'
import { ErrorNote } from '../../components/ErrorNote'
import { createPatient, findByPhone, getPayers, updatePatient } from './api'
import { getClinicDoctors } from '../appointments/api'

const SOURCES = ['facebook', 'instagram', 'google', 'friend', 'signboard', 'passing', 'payer', 'returning', 'other'] as const

export type EditablePatient = {
  id: string; full_name: string; phone: string; whatsapp_phone: string | null
  gender: string | null; date_of_birth: string | null; medical_alerts: string | null
  source: string | null; source_note: string | null; payer_id: string | null; primary_doctor_id: string | null
  recall_interval_months: number | null
  national_id: string | null; address: string | null
}

/** One form for adding and for editing a patient. */
export function PatientForm({ patient, onClose }: { patient?: EditablePatient; onClose: () => void }) {
  const { clinicId } = useMember()
  const hasPayers = useFeature('payers')
  const { t } = useI18n()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const payers = useQuery({ queryKey: ['payers', clinicId], queryFn: () => getPayers(clinicId) })
  const doctors = useQuery({ queryKey: ['clinic-doctors', clinicId], queryFn: () => getClinicDoctors(clinicId) })
  const [phoneError, setPhoneError] = useState(false)
  const [duplicate, setDuplicate] = useState<{ id: string; full_name: string } | null>(null)
  const dupAcknowledged = useRef(false)
  const [source, setSource] = useState(patient?.source ?? '')

  useEffect(() => { dialogRef.current?.showModal() }, [])

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const phone = normalizePhone(String(form.get('phone') ?? ''))
      const whatsappRaw = String(form.get('whatsapp') ?? '').trim()
      const whatsapp = whatsappRaw ? normalizePhone(whatsappRaw) : null
      if (!isValidPhone(phone) || (whatsapp && !isValidPhone(whatsapp))) {
        setPhoneError(true)
        return null
      }
      setPhoneError(false)

      // A shared number is normal here — a father books for his children on his
      // own phone. So it is a warning, not a wall: say who else has it, and let
      // the next press of Save go through.
      if (phone !== patient?.phone && !dupAcknowledged.current) {
        const existing = await findByPhone(clinicId, phone)
        if (existing && existing.id !== patient?.id) {
          setDuplicate(existing)
          dupAcknowledged.current = true
          return null
        }
      }

      const gender = String(form.get('gender') ?? '')
      const recall = String(form.get('recall') ?? '')
      const values = {
        full_name: String(form.get('full_name') ?? '').trim(),
        phone,
        whatsapp_phone: whatsapp,
        gender: gender === 'male' || gender === 'female' ? gender : null,
        date_of_birth: String(form.get('dob') ?? '') || null,
        medical_alerts: String(form.get('alerts') ?? '').trim() || null,
        source: source || null,
        source_note: String(form.get('source_note') ?? '').trim() || null,
        payer_id: String(form.get('payer') ?? '') || null,
        primary_doctor_id: String(form.get('doctor') ?? '') || null,
        recall_interval_months: recall === '' ? null : Number(recall),
        // Printed on the installment contract; blank until somebody needs it.
        national_id: String(form.get('national_id') ?? '').trim() || null,
        address: String(form.get('address') ?? '').trim() || null,
      }
      if (patient) {
        await updatePatient(patient.id, values)
        return patient.id
      }
      return createPatient({ ...values, clinic_id: clinicId })
    },
    onSuccess: (id) => {
      if (!id) return
      qc.invalidateQueries({ queryKey: ['patients'] })
      qc.invalidateQueries({ queryKey: ['patient', id] })
      if (patient) onClose()
      else navigate(`/patients/${id}`)
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setDuplicate(null)
    save.mutate(new FormData(e.currentTarget))
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} aria-labelledby="patient-form-title">
      <form onSubmit={onSubmit} className="dialog-body">
        <h2 id="patient-form-title">{patient ? t('patientForm.edit') : t('patientForm.title')}</h2>

        <label className="field">
          <span>{t('patientForm.fullName')}</span>
          <input name="full_name" required minLength={3} autoComplete="off" defaultValue={patient?.full_name} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>{t('patientForm.phone')}</span>
            <input name="phone" required inputMode="tel" dir="ltr" autoComplete="off" defaultValue={patient?.phone}
              aria-invalid={phoneError} onChange={() => { setDuplicate(null); dupAcknowledged.current = false }} />
          </label>
          <label className="field">
            <span>{t('patientForm.whatsapp')}</span>
            <input name="whatsapp" inputMode="tel" dir="ltr" autoComplete="off" defaultValue={patient?.whatsapp_phone ?? ''} />
          </label>
        </div>
        {phoneError && <p className="form-error" role="alert">{t('patientForm.phoneInvalid')}</p>}
        {duplicate && (
          <p className="warn-text" role="alert">
            {t('patientForm.duplicate', { name: duplicate.full_name })}{' '}
            <Link to={`/patients/${duplicate.id}`}>{t('patientForm.openExisting')}</Link>
            <br />
            <span className="hint">{t('patientForm.duplicateAllowed')}</span>
          </p>
        )}

        <div className="field-row">
          <label className="field">
            <span>{t('patientForm.gender')}</span>
            <select name="gender" defaultValue={patient?.gender ?? ''}>
              <option value="">{t('patientForm.gender.none')}</option>
              <option value="female">{t('patientForm.gender.female')}</option>
              <option value="male">{t('patientForm.gender.male')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('patientForm.dob')}</span>
            <input name="dob" type="date" max={todayLocal()} defaultValue={patient?.date_of_birth ?? ''} />
          </label>
          <label className="field">
            <span>{t('patientForm.recall')}</span>
            <select name="recall" defaultValue={patient?.recall_interval_months ?? 6}>
              <option value="">{t('patientForm.recallNone')}</option>
              {[3, 4, 6, 12].map((m) => <option key={m} value={m}>{t('patientForm.recallEvery', { n: m })}</option>)}
            </select>
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>{t('patientForm.source')}</span>
            <select name="source" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">{t('patientForm.sourceUnknown')}</option>
              {SOURCES.filter((x) => hasPayers || x !== 'payer' || patient?.source === 'payer').map((x) => <option key={x} value={x}>{t(`source.${x}` as Parameters<typeof t>[0])}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{source === 'payer' ? t('patientForm.payer') : t('patientForm.sourceNote')}</span>
            {source === 'payer' ? (
              <select name="payer" defaultValue={patient?.payer_id ?? ''}>
                <option value="">{t('patientForm.payerNone')}</option>
                {payers.data?.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.discount_percent}%</option>)}
              </select>
            ) : (
              <input name="source_note" defaultValue={patient?.source_note ?? ''} maxLength={120}
                placeholder={t('patientForm.sourceNoteHint')} />
            )}
          </label>
        </div>

        <label className="field">
          <span>{t('patientForm.doctor')}</span>
          <select name="doctor" defaultValue={patient?.primary_doctor_id ?? ''}>
            <option value="">{t('patientForm.doctorNone')}</option>
            {doctors.data?.map((d) => <option key={d.user_id} value={d.user_id}>{d.display_name}</option>)}
          </select>
        </label>

        <div className="field-row">
          <label className="field">
            <span>{t('patientForm.nationalId')}</span>
            <input name="national_id" dir="ltr" inputMode="numeric" maxLength={20}
              defaultValue={patient?.national_id ?? ''} />
            <small className="hint">{t('patientForm.nationalIdHint')}</small>
          </label>
          <label className="field">
            <span>{t('patientForm.address')}</span>
            <input name="address" maxLength={160} defaultValue={patient?.address ?? ''} />
          </label>
        </div>

        <label className="field">
          <span>{t('patientForm.alerts')}</span>
          <textarea name="alerts" rows={2} defaultValue={patient?.medical_alerts ?? ''} />
          <small className="hint">{t('patientForm.alertsHint')}</small>
        </label>

        {save.isError && <ErrorNote error={save.error} />}

        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>{t('common.cancel')}</button>
        </div>
      </form>
    </dialog>
  )
}
