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
import { LabCaseDialog } from './LabCaseDialog'

const tone: Record<string, string> = {
  at_lab: 'neutral', awaiting_tryin: 'neutral', tryin_ready: 'info',
  awaiting_delivery: 'neutral', delivered: 'info', received: 'info', fitted: 'ok', cancelled: 'muted',
}

export function LabCaseList({ cases, showPatient = true }: { cases: LabCase[]; showPatient?: boolean }) {
  const { clinicId, clinicName } = useMember()
  const { t, date, money } = useI18n()
  const queryClient = useQueryClient()
  const labs = useQuery({ queryKey: ['labs', clinicId], queryFn: () => getLabs(clinicId) })
  const labPhone = new Map((labs.data ?? []).map((l) => [l.id, l.phone]))
  const [postpone, setPostpone] = useState<LabCase | null>(null)
  const [newDate, setNewDate] = useState('')
  // Which month the clinic is charged for this case — normally the month it
  // came back, but work settled in an earlier month can be put back there.
  const [rebill, setRebill] = useState<LabCase | null>(null)
  const [billDate, setBillDate] = useState('')
  // Correcting a case after it was saved — most often a forgotten doctor.
  const [editing, setEditing] = useState<LabCase | null>(null)

  const update = useMutation({
    mutationFn: (a: { id: string; patch: Parameters<typeof updateCase>[1] }) => updateCase(a.id, a.patch),
    onSuccess: () => {
      setPostpone(null)
      setRebill(null)
      for (const k of ['lab-cases', 'today', 'finance', 'lab-invoice']) queryClient.invalidateQueries({ queryKey: [k] })
    },
  })

  return (
    <>
      {update.isError && <ErrorNote error={update.error} />}
      <ul className="work-list lab-list">
        {cases.map((c) => {
          const phone = c.lab_id ? labPhone.get(c.lab_id) : null
          const stage = (c.stage ?? 'at_lab') as string
          const chase = phone && c.stage_late ? waMessage(phone, templates.labChase({
            clinic: clinicName, description: c.description ?? '', patient: c.full_name ?? '',
            sentOn: c.sent_on ?? '', expectedOn: c.expected_on ?? '',
          })) : null
          return (
            <li key={c.id}>
              <div>
                <div className="plan-line">
                  <strong>{c.description}</strong>
                  <span className={`badge badge-${tone[stage] ?? 'neutral'}`}>
                    {t(`lab.stage.${stage}` as Parameters<typeof t>[0])}
                  </span>
                  {c.stage_late && <span className="badge badge-danger">{t('lab.lateBy', { n: c.days_late ?? 0 })}</span>}
                  {c.at_risk && <span className="badge badge-danger">{t('lab.atRisk')}</span>}
                </div>
                <p className="muted">
                  {showPatient && <><Link to={`/patients/${c.patient_id}`}>{c.full_name}</Link>{' — '}</>}
                  {c.lab_name}
                  {c.shade && <> — {t('lab.shade')} <span dir="ltr">{c.shade}</span></>}
                  {c.item_name && <> — {c.item_name}{c.units ? ` × ${c.units}` : ''}</>}
                  {c.lab_fee != null && <> — {money(c.lab_fee)}</>}
                </p>
                <p className="muted">
                  {c.doctor_name
                    ? <>{t('lab.doctor')}: {c.doctor_name}</>
                    : <span className="badge badge-danger">{t('lab.noDoctorYet')}</span>}
                </p>
                <p className="muted lab-dates">
                  {t('lab.scanShort', { date: date(c.sent_on) })}
                  {c.tryin_received_on && <> · {t('lab.tryinInShort', { date: date(c.tryin_received_on) })}</>}
                  {c.tryin_done_on && <> · {t('lab.tryinDoneShort', { date: date(c.tryin_done_on) })}</>}
                  {c.received_on && <> · {t('lab.receivedShort', { date: date(c.received_on), n: c.turnaround_days ?? 0 })}</>}
                  {c.fitted_on && <> · {t('lab.fittedShort', { date: date(c.fitted_on) })}</>}
                  {!c.fitted_on && c.next_due && (
                    <> · <span className={c.stage_late ? 'danger-text' : ''}>{t('lab.dueShort', { date: date(c.next_due) })}</span></>
                  )}
                  {c.next_appointment_at && !c.fitted_on && <> · {t('lab.nextAppt', { date: date(c.next_appointment_at) })}</>}
                </p>
                {c.lab_fee != null && c.lab_fee > 0 && (
                  <p className="muted small">
                    {t('lab.billedIn', { date: date(c.billed_on) })}{' '}
                    <button className="link-btn" onClick={() => { setRebill(c); setBillDate(c.billed_on ?? todayLocal()) }}>
                      {t('lab.changeMonth')}
                    </button>
                  </p>
                )}
              </div>
              <div className="work-meta">
                {stage === 'awaiting_tryin' && (
                  <>
                    <button className="btn btn-small btn-primary" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { tryin_received_on: todayLocal() } })}>
                      {t('lab.markTryinIn')}
                    </button>
                    {chase && <a className="btn btn-small" target="_blank" rel="noreferrer" href={chase}>{t('lab.chase')}</a>}
                  </>
                )}
                {stage === 'tryin_ready' && (
                  <>
                    <button className="btn btn-small btn-primary" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { tryin_done_on: todayLocal() } })}>
                      {t('lab.markTryinDone')}
                    </button>
                    <button className="link-btn" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { tryin_received_on: null } })}>
                      {t('lab.undoTryinIn')}
                    </button>
                  </>
                )}
                {(stage === 'awaiting_delivery' || stage === 'at_lab') && (
                  <>
                    <button className="btn btn-small btn-primary" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { received_on: todayLocal() } })}>
                      {t('lab.markReceived')}
                    </button>
                    <button className="btn btn-small" onClick={() => { setPostpone(c); setNewDate(c.expected_on ?? todayLocal()) }}>
                      {t('lab.postpone')}
                    </button>
                    {chase && <a className="btn btn-small" target="_blank" rel="noreferrer" href={chase}>{t('lab.chase')}</a>}
                  </>
                )}
                {(stage === 'delivered' || stage === 'received') && (
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
                  <button className="btn btn-small" onClick={() => setEditing(c)}>{t('common.edit')}</button>
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

      {editing && <LabCaseDialog editing={editing} onClose={() => setEditing(null)} />}

      {rebill && (
        <Modal title={t('lab.billingMonth')} onClose={() => setRebill(null)}>
          <form className="dialog-form" onSubmit={(e) => {
            e.preventDefault()
            if (billDate) update.mutate({ id: rebill.id!, patch: { billing_on: billDate } })
          }}>
            <p className="muted">{rebill.description}</p>
            <p className="hint">{t('lab.billingMonthHint')}</p>
            <label className="field">
              <span>{t('lab.billedOn')}</span>
              <input type="date" required value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </label>
            <div className="dialog-actions">
              <button type="submit" className="btn btn-primary" disabled={update.isPending}>{t('common.save')}</button>
              <button type="button" className="btn" onClick={() => setRebill(null)}>{t('common.cancel')}</button>
            </div>
          </form>
        </Modal>
      )}

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
