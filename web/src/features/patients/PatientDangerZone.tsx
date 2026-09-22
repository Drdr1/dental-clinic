import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { archivePatient, deletePatient, getRecordCounts } from './api'

/**
 * Two separate actions on purpose:
 *   archive – keeps every record, reversible, anyone on the team
 *   delete  – owner only, and only when nothing at all is attached
 */
export function PatientDangerZone({ patientId, archived, onClose }: {
  patientId: string; archived: boolean; onClose: () => void
}) {
  const { role } = useMember()
  const { t } = useI18n()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const counts = useQuery({ queryKey: ['record-counts', patientId], queryFn: () => getRecordCounts(patientId) })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['patient', patientId] })
    qc.invalidateQueries({ queryKey: ['patients'] })
  }

  const archive = useMutation({
    mutationFn: () => archivePatient(patientId, reason, !archived),
    onSuccess: () => { refresh(); onClose() },
  })
  const remove = useMutation({
    mutationFn: () => deletePatient(patientId),
    onSuccess: () => { refresh(); navigate('/patients') },
  })

  // Appointments alone don't block deleting; anything clinical or financial does.
  const attached = counts.data
    ? Object.entries(counts.data).filter(([k, v]) => k !== 'appointments' && v > 0)
    : []
  const canDelete = role === 'owner' && counts.isSuccess && attached.length === 0

  return (
    <Modal title={t('archive.title')} onClose={onClose}>
      <div className="dialog-form">
        {archived ? (
          <>
            <p>{t('archive.isArchived')}</p>
            {archive.isError && <ErrorNote error={archive.error} />}
            <div className="dialog-actions">
              <button className="btn btn-primary" disabled={archive.isPending} onClick={() => archive.mutate()}>
                {t('archive.unarchive')}
              </button>
              <button className="btn" onClick={onClose}>{t('common.close')}</button>
            </div>
          </>
        ) : (
          <>
            <p>{t('archive.explain')}</p>
            <label className="field">
              <span>{t('archive.reason')}</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
                placeholder={t('archive.reasonHint')} />
            </label>
            {archive.isError && <ErrorNote error={archive.error} />}
            <div className="dialog-actions">
              <button className="btn btn-primary" disabled={archive.isPending} onClick={() => archive.mutate()}>
                {t('archive.archive')}
              </button>
              <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
            </div>
          </>
        )}

        <hr className="rule" />

        <h3>{t('archive.deleteTitle')}</h3>
        {attached.length > 0 ? (
          <p className="muted">
            {t('archive.hasRecords', {
              list: attached.map(([k, v]) => `${t(`archive.rec.${k}` as Parameters<typeof t>[0])}: ${v}`).join('، '),
            })}
          </p>
        ) : (
          <p className="muted">{t('archive.deleteExplain')}</p>
        )}
        {role !== 'owner' && <p className="muted">{t('archive.ownerOnly')}</p>}
        {remove.isError && <ErrorNote error={remove.error} />}
        {canDelete && (
          <button className="btn btn-danger" disabled={remove.isPending}
            onClick={() => { if (confirm(t('archive.deleteConfirm'))) remove.mutate() }}>
            {t('archive.delete')}
          </button>
        )}
      </div>
    </Modal>
  )
}
