import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { errorKey } from '../../lib/errors'
import { recordSession } from './api'

export type OpenItem = { id: string; label: string }

type Props = {
  patientId: string
  plan: { id: string; title: string; openItems: OpenItem[] } | null
  onClose: () => void
}

export function SessionDialog({ patientId, plan, onClose }: Props) {
  const { isDoctor } = useAuth()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [done, setDone] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [isRecall, setIsRecall] = useState(!plan)
  const [overrideReason, setOverrideReason] = useState('')
  const [locked, setLocked] = useState(false)

  const save = useMutation({
    mutationFn: () =>
      recordSession({
        patientId,
        planId: plan?.id ?? null,
        notes,
        isRecallVisit: isRecall,
        doneItemIds: [...done],
        override: locked ? { reason: overrideReason } : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] })
      queryClient.invalidateQueries({ queryKey: ['today'] })
      if (plan) queryClient.invalidateQueries({ queryKey: ['plan', plan.id] })
      onClose()
    },
    onError: (error) => {
      if (errorKey(error) === 'err.sessionLocked') setLocked(true)
    },
  })

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canSubmit = !save.isPending && (!locked || (isDoctor && overrideReason.trim().length > 0))

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (canSubmit) save.mutate()
  }

  return (
    <Modal title={plan ? t('session.titlePlan', { plan: plan.title }) : t('session.titleVisit')} onClose={onClose}>
      <form onSubmit={onSubmit} className="dialog-form">
        {plan && plan.openItems.length > 0 && (
          <fieldset className="checklist">
            <legend>{t('session.whatWasDone')}</legend>
            {plan.openItems.map((item) => (
              <label key={item.id} className="check">
                <input type="checkbox" checked={done.has(item.id)} onChange={() => toggle(item.id)} />
                <span>{item.label}</span>
              </label>
            ))}
          </fieldset>
        )}

        <label className="field">
          <span>{t('session.notes')}</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <label className="check">
          <input type="checkbox" checked={isRecall} onChange={(e) => setIsRecall(e.target.checked)} />
          <span>{t('session.isRecall')}</span>
        </label>

        {locked && (
          <div className="lock-note">
            <p>{isDoctor ? t('session.lockedDoctor') : t('session.lockedReception')}</p>
            {isDoctor && (
              <label className="field">
                <span>{t('session.overrideReason')}</span>
                <input required value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} maxLength={200} />
              </label>
            )}
          </div>
        )}
        {save.isError && errorKey(save.error) !== 'err.sessionLocked' && <ErrorNote error={save.error} />}

        <div className="dialog-actions">
          <button type="submit" className={`btn ${locked ? 'btn-danger' : 'btn-primary'}`} disabled={!canSubmit}>
            {save.isPending ? t('common.saving') : locked ? t('session.saveOverride') : t('session.save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}
