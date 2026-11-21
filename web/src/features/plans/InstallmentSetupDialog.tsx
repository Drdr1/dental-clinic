import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { toIsoDate } from '../../lib/dates'
import { useMember } from '../auth/AuthProvider'
import { useQuery } from '@tanstack/react-query'
import { getSettings } from '../settings/api'
import { createInstallmentPlan, reviseInstallmentPlan } from './api'
import { previewSchedule } from './schedule'

type Props = {
  planId: string
  patientId: string
  netTotal: number
  onClose: () => void
  /** Present when re-planning an existing installment plan after the treatment changed. */
  revise?: { installmentPlanId: string; alreadyPaid: number }
}

/** The clinic collects on one of these days; every instalment lands on it. */
const DUE_DAYS = [5, 10, 15, 20, 25]

/** The first of the chosen days that is still ahead of us. */
function nextDueOn(day: number) {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), day)
  if (d <= now) d.setMonth(d.getMonth() + 1)
  return toIsoDate(d)
}

export function InstallmentSetupDialog({ planId, patientId, netTotal, onClose, revise }: Props) {
  const { t, money, date } = useI18n()
  const { clinicId } = useMember()
  const queryClient = useQueryClient()
  // Reception sets up most schedules, so this must not be owner-only.
  const settings = useQuery({ queryKey: ['settings', clinicId], queryFn: () => getSettings(clinicId) })
  const [down, setDown] = useState(revise ? '0' : '')
  const [months, setMonths] = useState('6')
  const [dueDay, setDueDay] = useState<number | null>(5)
  const [firstDue, setFirstDue] = useState(() => nextDueOn(5))
  const [reason, setReason] = useState('')

  // The clinic's usual day, if the owner has set one.
  const clinicDay = settings.data?.clinic.installment_day ?? null
  useEffect(() => {
    if (clinicDay && clinicDay !== dueDay && DUE_DAYS.includes(clinicDay)) {
      setDueDay(clinicDay)
      setFirstDue(nextDueOn(clinicDay))
    }
    // Only when the setting first arrives; the user's own pick wins after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicDay])

  const downValue = revise ? 0 : Number(down || 0)
  const monthsValue = Math.trunc(Number(months))
  const balance = Math.round((netTotal - (revise?.alreadyPaid ?? 0) - downValue) * 100) / 100
  const schedule = previewSchedule(balance, monthsValue, firstDue)
  const valid =
    downValue >= 0 && downValue <= netTotal &&
    (balance === 0 || (monthsValue >= 1 && monthsValue <= 60 && schedule.length > 0)) &&
    (!revise || reason.trim().length > 0)

  const save = useMutation({
    mutationFn: () =>
      revise
        ? reviseInstallmentPlan(revise.installmentPlanId, balance === 0 ? 0 : monthsValue, firstDue, reason)
        : createInstallmentPlan(planId, downValue, balance === 0 ? 0 : monthsValue, firstDue),
    onSuccess: () => {
      for (const key of [['plan', planId], ['patient', patientId], ['ledger', patientId], ['patients']]) {
        queryClient.invalidateQueries({ queryKey: key })
      }
      onClose()
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (valid && !save.isPending) save.mutate()
  }

  return (
    <Modal title={revise ? t('inst.reviseTitle') : t('inst.setupTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="dialog-form">
        <p className="muted">
          {revise
            ? t('inst.reviseSummary', { total: money(netTotal), paid: money(revise.alreadyPaid) })
            : t('inst.setupSummary', { total: money(netTotal) })}
        </p>

        <div className="field-row">
          {!revise && (
            <label className="field">
              <span>{t('inst.down')}</span>
              <input type="number" min="0" step="1" max={netTotal} dir="ltr" value={down}
                onChange={(e) => setDown(e.target.value)} placeholder="0" />
            </label>
          )}
          <label className="field">
            <span>{t('inst.months')}</span>
            <input type="number" min="1" max="60" step="1" dir="ltr" value={months}
              onChange={(e) => setMonths(e.target.value)} disabled={balance === 0} />
          </label>
          <label className="field">
            <span>{t('inst.dueDay')}</span>
            <select value={dueDay ?? ''} disabled={balance === 0}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null
                setDueDay(v)
                if (v) setFirstDue(nextDueOn(v))
              }}>
              {DUE_DAYS.map((d) => <option key={d} value={d}>{t('inst.dayOfMonth', { n: d })}</option>)}
              <option value="">{t('inst.customDate')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('inst.firstDue')}</span>
            <input type="date" value={firstDue} disabled={balance === 0}
              onChange={(e) => { setFirstDue(e.target.value); setDueDay(null) }} />
            {dueDay && <small className="hint">{t('inst.everyMonthOn', { n: dueDay })}</small>}
          </label>
        </div>

        {schedule.length > 0 && (
          <div className="allocation">
            <span className="allocation-title">
              {t('inst.previewTitle', { n: schedule.length, amount: money(schedule[0].amount) })}
            </span>
            <ul className="schedule-preview">
              {schedule.map((l) => (
                <li key={l.seq}>
                  <span>{t('inst.number', { n: l.seq })} — {date(l.dueDate)}</span>
                  <span>{money(l.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {balance === 0 && <p className="ok-text">{t('inst.nothingLeft')}</p>}

        {revise && (
          <label className="field">
            <span>{t('inst.reviseReason')}</span>
            <input required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          </label>
        )}

        {save.isError && <ErrorNote error={save.error} />}

        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={!valid || save.isPending}>
            {save.isPending ? t('common.saving') : revise ? t('inst.reviseSubmit') : t('inst.setupSubmit')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}
