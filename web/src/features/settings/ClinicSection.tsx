import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth, useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { saveClinic, type ClinicSettings } from './api'

const hhmm = (t: string) => t.slice(0, 5)

export type ClinicPart = 'clinic' | 'hours' | 'installments'

export function ClinicSection({ initial, part }: { initial: ClinicSettings; part: ClinicPart }) {
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
      <h2>{t(part === 'clinic' ? 'settings.clinic' : part === 'hours' ? 'settings.hours' : 'settings.installmentRules')}</h2>
      {part === 'clinic' && <>
      <label className="field">
        <span>{t('settings.clinicName')}</span>
        <input required value={s.name} onChange={(e) => set('name', e.target.value)} maxLength={80} />
        <small className="hint">{t('settings.clinicNameHint')}</small>
      </label>


      <label className="field">
        <span>{t('settings.cashFloat')}</span>
        <input type="number" min={0} step={50} required dir="ltr" value={s.cash_float}
          onChange={(e) => set('cash_float', Number(e.target.value))} />
        <small className="hint">{t('settings.cashFloatHint')}</small>
      </label>

      <label className="field">
        <span>{t('settings.commissionBasis')}</span>
        <select value={s.commission_basis} onChange={(e) => set('commission_basis', e.target.value)}>
          <option value="work">{t('settings.basisWork')}</option>
          <option value="collection">{t('settings.basisCollection')}</option>
          <option value="collection_net_lab">{t('settings.basisNetLab')}</option>
          <option value="clinic_income">{t('settings.basisClinicIncome')}</option>
        </select>
        <small className="hint">{t('settings.commissionBasisHint')}</small>
      </label>

      <label className="field">
        <span>{t('settings.adminPercent')}</span>
        <input type="number" min={0} max={100} step="any" required dir="ltr" value={s.admin_percent}
          onChange={(e) => set('admin_percent', Number(e.target.value))} />
        <small className="hint">{t('settings.adminPercentHint')}</small>
      </label>

      </>}
      {part === 'hours' && <>
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
      </>}
      {part === 'installments' && <>

      <label className="field">
        <span>{t('inst.dueDay')}</span>
        <select value={s.installment_day ?? ''}
          onChange={(e) => set('installment_day', e.target.value ? Number(e.target.value) : null)}>
          {[5, 10, 15, 20, 25].map((d) => <option key={d} value={d}>{t('inst.dayOfMonth', { n: d })}</option>)}
          <option value="">{t('inst.noFixedDay')}</option>
        </select>
        <small className="hint">{t('settings.dueDayHint')}</small>
      </label>
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

      <label className="field">
        <span>{t('settings.suspendAfter')}</span>
        <input type="number" min={1} max={90} required dir="ltr" value={s.suspend_after_days}
          onChange={(e) => set('suspend_after_days', Number(e.target.value))} />
        <small className="hint">{t('settings.suspendAfterHint')}</small>
      </label>

      {/* Printed on every installment contract: who signs for the clinic,
          and whose courts hear a dispute. */}
      <div className="field-row">
        <label className="field">
          <span>{t('settings.representedBy')}</span>
          <input value={s.represented_by ?? ''} maxLength={80}
            onChange={(e) => set('represented_by', e.target.value || null)} />
          <small className="hint">{t('settings.representedByHint')}</small>
        </label>
        <label className="field">
          <span>{t('settings.legalVenue')}</span>
          <input value={s.legal_venue ?? ''} maxLength={60}
            onChange={(e) => set('legal_venue', e.target.value || null)} />
          <small className="hint">{t('settings.legalVenueHint')}</small>
        </label>
      </div>

      </>}

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
