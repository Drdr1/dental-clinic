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
  const [force, setForce] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const remove = useMutation({
    mutationFn: () => deletePatient(patientId, force, deleteReason.trim() || t('archive.noReason')),
    onSuccess: () => { refresh(); navigate('/patients') },
  })

  // Appointments alone don't block deleting; anything clinical or financial does.
  const attached = counts.data
    ? Object.entries(counts.data).filter(([k, v]) => k !== 'appointments' && v > 0)
    : []
  const canDelete = role === 'owner' && counts.isSuccess && (attached.length === 0 || force)

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
          <>
            <p className="muted">
              {t('archive.hasRecordsOwner', {
                list: attached.map(([k, v]) => `${t(`archive.rec.${k}` as Parameters<typeof t>[0])}: ${v}`).join('، '),
              })}
            </p>
            {role === 'owner' && (
              <div className="lock-note">
                <p>{t('archive.forceWarn')}</p>
                <label className="check">
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                  <span>{t('archive.forceConfirm')}</span>
                </label>
                {force && (
                  <label className="field"><span>{t('archive.forceReasonOptional')}</span>
                    <input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} maxLength={200} /></label>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="muted">{t('archive.deleteExplain')}</p>
        )}
        {role !== 'owner' && <p className="muted">{t('archive.ownerOnly')}</p>}
        {remove.isError && <ErrorNote error={remove.error} />}
        {role === 'owner' && (
          <div className="dialog-actions">
            <button className="btn btn-danger" disabled={!canDelete || remove.isPending}
              onClick={() => { if (confirm(t('archive.deleteConfirm'))) remove.mutate() }}>
              {remove.isPending ? t('common.saving') : t('archive.delete')}
            </button>
            {/* Say why it's disabled instead of hiding the button and leaving them guessing. */}
            {!canDelete && <span className="muted small">{t('archive.needTick')}</span>}
          </div>
        )}
      </div>
    </Modal>
  )
}
