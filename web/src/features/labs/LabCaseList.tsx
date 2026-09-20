import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Modal } from '../../components/Modal'
import { todayLocal } from '../../lib/dates'
import { templates, waMessage } from '../../lib/whatsapp'
import { getLabs, updateCase, type LabCase } from './api'

const tone: Record<string, string> = { at_lab: 'neutral', late: 'warn', received: 'info', fitted: 'ok' }

export function LabCaseList({ cases, showPatient = true }: { cases: LabCase[]; showPatient?: boolean }) {
  const { clinicId, clinicName } = useMember()
  const { t, date, money } = useI18n()
  const queryClient = useQueryClient()
  const labs = useQuery({ queryKey: ['labs', clinicId], queryFn: () => getLabs(clinicId) })
  const labPhone = new Map((labs.data ?? []).map((l) => [l.id, l.phone]))
  const [postpone, setPostpone] = useState<LabCase | null>(null)
  const [newDate, setNewDate] = useState('')

  const update = useMutation({
    mutationFn: (a: { id: string; patch: Parameters<typeof updateCase>[1] }) => updateCase(a.id, a.patch),
    onSuccess: () => {
      setPostpone(null)
      for (const k of ['lab-cases', 'today']) queryClient.invalidateQueries({ queryKey: [k] })
    },
  })

  return (
    <>
      {update.isError && <ErrorNote error={update.error} />}
      <ul className="work-list lab-list">
        {cases.map((c) => {
          const phone = c.lab_id ? labPhone.get(c.lab_id) : null
          return (
            <li key={c.id}>
              <div>
                <div className="plan-line">
                  <strong>{c.description}</strong>
                  <span className={`badge badge-${tone[c.status ?? 'at_lab']}`}>{t(`lab.status.${c.status ?? 'at_lab'}` as Parameters<typeof t>[0])}</span>
                  {c.at_risk && <span className="badge badge-danger">{t('lab.atRisk')}</span>}
                </div>
                <p className="muted">
                  {showPatient && <><Link to={`/patients/${c.patient_id}`}>{c.full_name}</Link>{' — '}</>}
                  {c.lab_name}
                  {c.shade && <> — {t('lab.shade')} <span dir="ltr">{c.shade}</span></>}
                  {c.lab_fee != null && <> — {money(c.lab_fee)}</>}
                </p>
                <p className="muted lab-dates">
                  {t('lab.sentShort', { date: date(c.sent_on) })}
                  {' · '}
                  {c.received_on
                    ? t('lab.receivedShort', { date: date(c.received_on), n: c.turnaround_days ?? 0 })
                    : t('lab.expectedShort', { date: date(c.expected_on) })}
                  {c.fitted_on && <> · {t('lab.fittedShort', { date: date(c.fitted_on) })}</>}
                  {c.next_appointment_at && !c.fitted_on && <> · {t('lab.nextAppt', { date: date(c.next_appointment_at) })}</>}
                </p>
              </div>
              <div className="work-meta">
                {!c.received_on && (
                  <>
                    <button className="btn btn-small btn-primary" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { received_on: todayLocal() } })}>
                      {t('lab.markReceived')}
                    </button>
                    <button className="btn btn-small" onClick={() => { setPostpone(c); setNewDate(c.expected_on ?? todayLocal()) }}>
                      {t('lab.postpone')}
                    </button>
                    {phone && c.status === 'late' && (
                      <a className="btn btn-small" target="_blank" rel="noreferrer"
                        href={waMessage(phone, templates.labChase({
                          clinic: clinicName, description: c.description ?? '', patient: c.full_name ?? '',
                          sentOn: c.sent_on ?? '', expectedOn: c.expected_on ?? '',
                        }))}>
                        {t('lab.chase')}
                      </a>
                    )}
                  </>
                )}
                {c.received_on && !c.fitted_on && (
                  <>
                    <button className="btn btn-small btn-primary" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { fitted_on: todayLocal() } })}>
                      {t('lab.markFitted')}
                    </button>
                    <button className="link-btn" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { received_on: null } })}>
                      {t('lab.undoReceived')}
                    </button>
                  </>
                )}
                {!c.fitted_on && (
                  <button className="link-btn danger-link" disabled={update.isPending}
                    onClick={() => { if (confirm(t('lab.cancelConfirm'))) update.mutate({ id: c.id!, patch: { cancelled_at: new Date().toISOString() } }) }}>
                    {t('lab.cancel')}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {postpone && (
        <Modal title={t('lab.postpone')} onClose={() => setPostpone(null)}>
          <form className="dialog-form" onSubmit={(e) => {
            e.preventDefault()
            if (newDate) update.mutate({ id: postpone.id!, patch: { expected_on: newDate } })
          }}>
            <p className="muted">{postpone.description}</p>
            <label className="field">
              <span>{t('lab.expectedOn')}</span>
              <input type="date" required min={postpone.sent_on ?? undefined} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </label>
            <div className="dialog-actions">
              <button type="submit" className="btn btn-primary" disabled={update.isPending}>{t('common.save')}</button>
              <button type="button" className="btn" onClick={() => setPostpone(null)}>{t('common.cancel')}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
