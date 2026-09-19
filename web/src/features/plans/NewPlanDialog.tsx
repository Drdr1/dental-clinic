import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { createPlan } from './api'

export function NewPlanDialog({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')

  const create = useMutation({
    mutationFn: () => createPlan(clinicId, patientId, title),
    onSuccess: (planId) => navigate(`/plans/${planId}`),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (title.trim() && !create.isPending) create.mutate()
  }

  return (
    <Modal title={t('plan.new')} onClose={onClose}>
      <form onSubmit={onSubmit} className="dialog-form">
        <label className="field">
          <span>{t('plan.titleLabel')}</span>
          <input required autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={t('plan.titleHint')} maxLength={120} />
        </label>
        {create.isError && <ErrorNote error={create.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={!title.trim() || create.isPending}>
            {create.isPending ? t('common.saving') : t('plan.create')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}
