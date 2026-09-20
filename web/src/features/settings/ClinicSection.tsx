import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth, useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { saveClinic, type ClinicSettings } from './api'

const hhmm = (t: string) => t.slice(0, 5)

export function ClinicSection({ initial }: { initial: ClinicSettings }) {
  const { clinicId } = useMember()
  const { reloadMember } = useAuth()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [s, setS] = useState({ ...initial, opens_at: hhmm(initial.opens_at), closes_at: hhmm(initial.closes_at) })
  const set = <K extends keyof ClinicSettings>(k: K, v: ClinicSettings[K]) => setS((prev) => ({ ...prev, [k]: v }))
  const hoursValid = s.closes_at > s.opens_at

  const save = useMutation({
    mutationFn: () => saveClinic(clinicId, s),
    onSuccess: () => {
      reloadMember()
      for (const k of ['settings', 'calendar', 'day', 'today']) queryClient.invalidateQueries({ queryKey: [k] })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (hoursValid && s.name.trim() && !save.isPending) save.mutate()
  }

  return (
    <form className="panel settings-form" onSubmit={onSubmit}>
      <h2>{t('settings.clinic')}</h2>
      <label className="field">
        <span>{t('settings.clinicName')}</span>
        <input required value={s.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
        <small className="hint">{t('settings.clinicNameHint')}</small>
      </label>

      <div className="field-row">
        <label className="field">
          <span>{t('settings.opensAt')}</span>
          <input type="time" required value={s.opens_at} onChange={(e) => set('opens_at', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('settings.closesAt')}</span>
          <input type="time" required value={s.closes_at} onChange={(e) => set('closes_at', e.target.value)}
            aria-invalid={!hoursValid} />
        </label>
        <label className="field">
          <span>{t('settings.slot')}</span>
          <select value={s.slot_minutes} onChange={(e) => set('slot_minutes', Number(e.target.value))}>
            {[10, 15, 20, 30].map((m) => <option key={m} value={m}>{t('appt.minutes', { n: m })}</option>)}
          </select>
        </label>
      </div>
      {!hoursValid && <p className="form-error">{t('settings.hoursInvalid')}</p>}

      <label className="field">
        <span>{t('settings.cashFloat')}</span>
        <input type="number" min={0} step={50} required dir="ltr" value={s.cash_float}
          onChange={(e) => set('cash_float', Number(e.target.value))} />
        <small className="hint">{t('settings.cashFloatHint')}</small>
      </label>

      <h3>{t('settings.installmentRules')}</h3>
      <div className="field-row">
        <label className="field">
          <span>{t('settings.graceDays')}</span>
          <input type="number" min={0} max={30} required dir="ltr" value={s.grace_days}
            onChange={(e) => set('grace_days', Number(e.target.value))} />
          <small className="hint">{t('settings.graceDaysHint')}</small>
        </label>
        <label className="field">
          <span>{t('settings.lockThreshold')}</span>
          <input type="number" min={1} max={12} required dir="ltr" value={s.lock_threshold}
            onChange={(e) => set('lock_threshold', Number(e.target.value))} />
          <small className="hint">{t('settings.lockThresholdHint')}</small>
        </label>
      </div>

      {save.isError && <ErrorNote error={save.error} />}
      <div className="dialog-actions">
        <button type="submit" className="btn btn-primary" disabled={save.isPending || !hoursValid}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        {save.isSuccess && !save.isPending && <span className="ok-text">{t('settings.saved')}</span>}
      </div>
    </form>
  )
}
