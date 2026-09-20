import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { waMessage } from '../../lib/whatsapp'
import { getPatientPlans } from '../appointments/api'
import { createRequest, getPatientForms, getSubmission, getTemplates } from './api'
import { optionLabel, optionValue, qLabel } from './labels'

type Patient = { id: string; full_name: string; phone: string; whatsapp_phone?: string | null }

function SendDialog({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const { clinicId, clinicName } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const templates = useQuery({ queryKey: ['form-templates', clinicId], queryFn: () => getTemplates(clinicId) })
  const plans = useQuery({ queryKey: ['patient-plans', patient.id], queryFn: () => getPatientPlans(patient.id) })
  const [templateId, setTemplateId] = useState('')
  const [planId, setPlanId] = useState('')
  const chosen = templates.data?.find((x) => x.id === (templateId || templates.data?.[0]?.id))
  const create = useMutation({
    mutationFn: () => createRequest(patient.id, chosen!.id, chosen!.kind === 'consent' ? planId || null : null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patient-forms', patient.id] }),
  })
  const link = create.data ? `${window.location.origin}/f/${create.data}` : ''
  const first = patient.full_name.trim().split(/\s+/)[0]
  const message = `أهلًا ${first}، ده ${clinicName}. قبل ميعادك ياريت تملى ${chosen?.title ?? ''} وتمضي عليه من اللينك ده (صالح 3 أيام): ${link}`

  return (
    <Modal title={t('forms.send')} onClose={onClose}>
      {!create.isSuccess ? (
        <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); if (chosen) create.mutate() }}>
          <label className="field"><span>{t('forms.template')}</span>
            <select value={chosen?.id ?? ''} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.data?.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select></label>
          {chosen?.kind === 'consent' && (plans.data?.length ?? 0) > 0 && (
            <label className="field"><span>{t('forms.forPlan')}</span>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">{t('forms.noPlan')}</option>
                {plans.data!.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select></label>
          )}
          {create.isError && <ErrorNote error={create.error} />}
          <div className="dialog-actions">
            <button type="submit" className="btn btn-primary" disabled={!chosen || create.isPending}>{t('forms.createLink')}</button>
            <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          </div>
        </form>
      ) : (
        <div className="dialog-form">
          <p>{t('forms.linkReady')}</p>
          <input readOnly dir="ltr" value={link} onFocus={(e) => e.target.select()} className="link-box" />
          <div className="dialog-actions">
            <a className="btn btn-primary" target="_blank" rel="noreferrer" href={waMessage(patient.whatsapp_phone ?? patient.phone, message)}>
              {t('forms.sendWhatsapp')}
            </a>
            <a className="btn" target="_blank" rel="noreferrer" href={link}>{t('forms.openHere')}</a>
            <button className="btn" onClick={onClose}>{t('common.close')}</button>
          </div>
          <p className="hint">{t('forms.linkHint')}</p>
        </div>
      )}
    </Modal>
  )
}

function ViewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, lang, date } = useI18n()
  const q = useQuery({ queryKey: ['submission', id], queryFn: () => getSubmission(id) })
  const answers = (q.data?.submission.answers ?? {}) as Record<string, unknown>
  const render = (v: unknown, opts?: Array<string | { value: string }>) => {
    if (Array.isArray(v)) return v.map((x) => optionLabel(opts?.find((o) => optionValue(o) === x) ?? String(x), lang)).join('، ') || '—'
    if (v === 'yes') return t('pform.yes')
    if (v === 'no') return t('pform.no')
    return (v as string) || '—'
  }
  return (
    <Modal title={q.data?.template.title ?? ''} onClose={onClose}>
      {q.isError && <ErrorNote error={q.error} />}
      {q.data && (
        <div className="dialog-form">
          {q.data.template.kind === 'consent' && (
            <p className="consent-text">{lang === 'ar' ? q.data.template.body.text_ar : q.data.template.body.text_en}</p>
          )}
          <dl className="answers">
            {(q.data.template.body.questions ?? []).map((qq) => (
              <div key={qq.id}><dt>{qLabel(qq, lang)}</dt><dd>{render(answers[qq.id], qq.type === 'multi' ? qq.options : undefined)}</dd></div>
            ))}
          </dl>
          <div className="signed-block">
            <img src={q.data.submission.signature_data} alt={t('pform.signature')} className="sig-image" />
            <p className="muted">{t('forms.signedBy', { name: q.data.submission.signed_by_name, date: date(q.data.submission.signed_at) })}</p>
          </div>
          <div className="dialog-actions"><button className="btn" onClick={onClose}>{t('common.close')}</button></div>
        </div>
      )}
    </Modal>
  )
}

export function PatientForms({ patient }: { patient: Patient }) {
  const { t, date } = useI18n()
  const [sending, setSending] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['patient-forms', patient.id], queryFn: () => getPatientForms(patient.id) })
  const history = q.data?.submissions.find((s) => s.template?.kind === 'medical_history')
  const stale = history && Date.now() - Date.parse(history.signed_at) > 365 * 86400_000

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('forms.title')}</h2>
        <button className="btn" onClick={() => setSending(true)}>{t('forms.send')}</button>
      </div>
      {q.isError && <ErrorNote error={q.error} />}
      {q.data && !history && <p className="warn-text">{t('forms.noHistory')}</p>}
      {stale && <p className="warn-text">{t('forms.historyOld')}</p>}
      <ul className="plan-list">
        {q.data?.pending.map((p) => (
          <li key={p.id}><div className="plan-line"><span>{p.template?.title}</span>
            <span className="badge badge-neutral">{t('forms.waiting', { date: date(p.expires_at) })}</span></div></li>
        ))}
        {q.data?.submissions.map((s) => (
          <li key={s.id}>
            <button type="button" className="appt-row" onClick={() => setViewing(s.id)}>
              <span>{s.template?.title}</span>
              <span className="badge badge-ok">{t('forms.signedOn', { date: date(s.signed_at) })}</span>
            </button>
          </li>
        ))}
      </ul>
      {sending && <SendDialog patient={patient} onClose={() => setSending(false)} />}
      {viewing && <ViewDialog id={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}
