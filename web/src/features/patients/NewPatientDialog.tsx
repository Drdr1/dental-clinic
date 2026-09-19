import { todayLocal } from '../../lib/dates'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { isValidPhone, normalizePhone } from '../../lib/phone'
import { ErrorNote } from '../../components/ErrorNote'
import { createPatient, findByPhone } from './api'

type Duplicate = { id: string; full_name: string }

export function NewPatientDialog({ onClose }: { onClose: () => void }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [phoneError, setPhoneError] = useState(false)
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

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

      const existing = await findByPhone(clinicId, phone)
      if (existing) {
        setDuplicate(existing)
        return null
      }

      const gender = String(form.get('gender') ?? '')
      return createPatient({
        clinic_id: clinicId,
        full_name: String(form.get('full_name') ?? '').trim(),
        phone,
        whatsapp_phone: whatsapp,
        gender: gender === 'male' || gender === 'female' ? gender : null,
        date_of_birth: String(form.get('dob') ?? '') || null,
        medical_alerts: String(form.get('alerts') ?? '').trim() || null,
      })
    },
    onSuccess: (id) => {
      if (!id) return
      queryClient.invalidateQueries({ queryKey: ['patients', clinicId] })
      navigate(`/patients/${id}`)
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setDuplicate(null)
    save.mutate(new FormData(e.currentTarget))
  }

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose} aria-labelledby="new-patient-title">
      <form onSubmit={onSubmit} className="dialog-body">
        <h2 id="new-patient-title">{t('patientForm.title')}</h2>

        <label className="field">
          <span>{t('patientForm.fullName')}</span>
          <input name="full_name" required minLength={3} autoComplete="off" />
        </label>

        <div className="field-row">
          <label className="field">
            <span>{t('patientForm.phone')}</span>
            <input name="phone" required inputMode="tel" dir="ltr" autoComplete="off"
              aria-invalid={phoneError} onChange={() => setDuplicate(null)} />
          </label>
          <label className="field">
            <span>{t('patientForm.whatsapp')}</span>
            <input name="whatsapp" inputMode="tel" dir="ltr" autoComplete="off" />
          </label>
        </div>
        {phoneError && <p className="form-error" role="alert">{t('patientForm.phoneInvalid')}</p>}
        {duplicate && (
          <p className="form-error" role="alert">
            {t('patientForm.duplicate', { name: duplicate.full_name })}{' '}
            <Link to={`/patients/${duplicate.id}`}>{t('patientForm.openExisting')}</Link>
          </p>
        )}

        <div className="field-row">
          <label className="field">
            <span>{t('patientForm.gender')}</span>
            <select name="gender" defaultValue="">
              <option value="">{t('patientForm.gender.none')}</option>
              <option value="female">{t('patientForm.gender.female')}</option>
              <option value="male">{t('patientForm.gender.male')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('patientForm.dob')}</span>
            <input name="dob" type="date" max={todayLocal()} />
          </label>
        </div>

        <label className="field">
          <span>{t('patientForm.alerts')}</span>
          <textarea name="alerts" rows={2} />
          <small className="hint">{t('patientForm.alertsHint')}</small>
        </label>

        {save.isError && <ErrorNote error={save.error} />}

        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </dialog>
  )
}
