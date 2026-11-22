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


export function LabCaseList({ cases, showPatient = true }: { cases: LabCase[]; showPatient?: boolean }) {
  const { clinicId, clinicName } = useMember()
  const { t, day, time } = useI18n()
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
      <ul className="lab-cards">
        {cases.map((c) => {
          const phone = c.lab_id ? labPhone.get(c.lab_id) : null
          const stage = (c.stage ?? 'at_lab') as string
          const chase = phone && c.stage_late ? waMessage(phone, templates.labChase({
            clinic: clinicName, description: c.description ?? '', patient: c.full_name ?? '',
            sentOn: c.sent_on ?? '', expectedOn: c.expected_on ?? '',
          })) : null
          // The five steps of a case, the try-in only when this work has one. Steps up to
          // and including where the case is now are filled; a late step turns red.
          const keys = ['scan', 'lab', ...(c.needs_tryin ? ['tryin'] : []), 'back', 'fitted']
          const at = stage === 'fitted' ? 'fitted'
            : stage === 'received' || stage === 'delivered' ? 'back'
            : stage === 'tryin_ready' ? 'tryin'
            : stage === 'awaiting_delivery' ? (c.needs_tryin ? 'tryin' : 'lab')
            : stage === 'awaiting_tryin' ? (c.stage_late ? 'tryin' : 'lab')
            : c.sent_on === todayLocal() ? 'scan' : 'lab'
          const current = Math.max(0, keys.indexOf(at))
          const today = todayLocal()
          const right = c.stage_late ? { text: t('lab.lateBy', { n: c.days_late ?? 0 }), danger: true }
            : c.fitted_on ? { text: t('lab.fittedOn', { date: day(c.fitted_on) }), danger: false }
            : c.received_on ? { text: c.received_on === today ? t('lab.backToday') : t('lab.backOn', { date: day(c.received_on) }), danger: false }
            : c.sent_on === today ? { text: t('lab.sentToday'), danger: false }
            : c.next_due ? { text: t('lab.dueOn', { date: day(c.next_due) }), danger: false }
            : null
          const sub = [c.description, c.item_name && c.units ? `${c.units} ${t('lab.unitsShort')}` : null,
            c.shade ? t('plan.shade', { s: c.shade }) : null, c.lab_name].filter(Boolean).join(' · ')
          return (
            <li key={c.id} className="lab-card">
              <div className="lab-card-top">
                <div>
                  {showPatient
                    ? <Link to={`/patients/${c.patient_id}`} className="row-link strong">{c.full_name}</Link>
                    : <strong>{c.description}</strong>}
                  <p className="muted small">{showPatient ? sub : [c.full_name, c.shade ? t('plan.shade', { s: c.shade }) : null].filter(Boolean).join(' · ')}</p>
                  {c.at_risk && c.next_appointment_at && !c.fitted_on && (
                    <p className="danger-text small">{t('lab.atRiskLine', { date: day(c.next_appointment_at), time: time(c.next_appointment_at) })}</p>
                  )}
                  {!c.at_risk && c.next_appointment_at && c.received_on && !c.fitted_on && (
                    <p className="small">{t('lab.fitAppt', { date: day(c.next_appointment_at), time: time(c.next_appointment_at) })}</p>
                  )}
                  {!c.doctor_name && <span className="badge badge-danger">{t('lab.noDoctorYet')}</span>}
                </div>
                {right && <span className={`small nowrap ${right.danger ? 'late-text' : 'muted'}`}>{right.text}</span>}
              </div>

              <ol className="lab-steps" style={{ ['--n' as string]: keys.length }}>
                {keys.map((k, i) => (
                  <li key={k} className={`${i <= current ? 'done' : ''} ${i === current ? 'now' : ''} ${i === current && c.stage_late ? 'late' : ''}`}>
                    <i />{t(`lab.step.${k}` as Parameters<typeof t>[0])}
                  </li>
                ))}
              </ol>

              <div className="lab-actions">
                {stage === 'awaiting_tryin' && (
                  <>
                    <button className="btn btn-small btn-ink" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { tryin_received_on: todayLocal() } })}>
                      {t('lab.markTryinIn')}
                    </button>
                    {chase && <a className="btn btn-small" target="_blank" rel="noreferrer" href={chase}>{t('lab.askLab')}</a>}
                  </>
                )}
                {stage === 'tryin_ready' && (
                  <>
                    <button className="btn btn-small btn-ink" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { tryin_done_on: todayLocal() } })}>
                      {t('lab.markTryinDone')}
                    </button>
                    <button className="link-btn small" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { tryin_received_on: null } })}>
                      {t('lab.undoTryinIn')}
                    </button>
                  </>
                )}
                {(stage === 'awaiting_delivery' || stage === 'at_lab') && (
                  <>
                    <button className="btn btn-small btn-ink" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { received_on: todayLocal() } })}>
                      {t('lab.markReceived')}
                    </button>
                    <button className="btn btn-small" onClick={() => { setPostpone(c); setNewDate(c.expected_on ?? todayLocal()) }}>
                      {t('lab.postponeShort')}
                    </button>
                    {chase && <a className="btn btn-small" target="_blank" rel="noreferrer" href={chase}>{t('lab.askLab')}</a>}
                  </>
                )}
                {(stage === 'delivered' || stage === 'received') && (
                  <>
                    <button className="btn btn-small btn-ink" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { fitted_on: todayLocal() } })}>
                      {t('lab.markFitted')}
                    </button>
                    <button className="link-btn small" disabled={update.isPending}
                      onClick={() => update.mutate({ id: c.id!, patch: { received_on: null } })}>
                      {t('lab.undoReceived')}
                    </button>
                  </>
                )}
                <span className="lab-more">
                  {!c.fitted_on && <button className="link-btn small" onClick={() => setEditing(c)}>{t('common.edit')}</button>}
                  {c.lab_fee != null && c.lab_fee > 0 && (
                    <button className="link-btn small" onClick={() => { setRebill(c); setBillDate(c.billed_on ?? todayLocal()) }}>
                      {t('lab.changeMonth')}
                    </button>
                  )}
                  {!c.fitted_on && (
                    <button className="link-btn small danger-link" disabled={update.isPending}
                      onClick={() => { if (confirm(t('lab.cancelConfirm'))) update.mutate({ id: c.id!, patch: { cancelled_at: new Date().toISOString() } }) }}>
                      {t('lab.cancel')}
                    </button>
                  )}
                </span>
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
