import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { errorKey } from '../../lib/errors'
import { createPrescription, getAllergyGroups, getCatalog, getConflicts, saveTemplate, type Drug, type RxLine } from './api'

type Patient = { id: string; full_name: string; medical_alerts: string | null; allergy_groups: string[] }

let seq = 0
const lineFrom = (d: Drug, o?: Partial<RxLine>): RxLine => ({
  key: `l${++seq}`, drug_id: d.id, drug_name: d.name, allergy_group: d.allergy_group,
  dose: o?.dose || d.default_dose || '', frequency: o?.frequency || d.default_frequency || '',
  duration: o?.duration || d.default_duration || '', notes: o?.notes || d.default_notes || '',
})

export function PrescriptionDialog({ patient, planId, onClose }: { patient: Patient; planId?: string; onClose: () => void }) {
  const { clinicId } = useMember()
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const catalog = useQuery({ queryKey: ['rx-catalog', clinicId], queryFn: () => getCatalog(clinicId) })
  const groups = useQuery({ queryKey: ['allergy-groups'], queryFn: getAllergyGroups, staleTime: Infinity })
  const [lines, setLines] = useState<RxLine[]>([])
  const [pick, setPick] = useState('')
  const [notes, setNotes] = useState('')
  const [override, setOverride] = useState('')
  const [templateName, setTemplateName] = useState<string | null>(null)

  const drugIds = useMemo(() => lines.map((l) => l.drug_id).filter((x): x is string => !!x).sort(), [lines])
  const conflicts = useQuery({
    queryKey: ['rx-conflicts', patient.id, drugIds.join(',')],
    queryFn: () => getConflicts(patient.id, drugIds),
  })
  const conflictFor = (drugId: string | null) => conflicts.data?.find((c) => c.drug_id === drugId)
  const hasConflict = (conflicts.data?.length ?? 0) > 0
  const groupLabel = (code: string) => {
    const g = groups.data?.find((x) => x.code === code)
    return g ? (lang === 'ar' ? g.label_ar : g.label_en) : code
  }

  const drugs = (catalog.data?.drugs ?? []).filter((d) => d.active)

  function addPicked() {
    const text = pick.trim()
    if (!text) return
    const d = drugs.find((x) => x.name.toLowerCase() === text.toLowerCase())
    setLines((ls) => [...ls, d ? lineFrom(d) : {
      key: `l${++seq}`, drug_id: null, drug_name: text, allergy_group: null, dose: '', frequency: '', duration: '', notes: '',
    }])
    setPick('')
  }
  function applyTemplate(id: string) {
    const tpl = catalog.data?.templates.find((x) => x.id === id)
    if (!tpl) return
    const add = tpl.items.map((it) => {
      const d = drugs.find((x) => x.id === it.drug_id)
      return d ? lineFrom(d, it) : null
    }).filter((x): x is RxLine => !!x)
    setLines((ls) => [...ls, ...add])
  }
  const update = (key: string, patch: Partial<RxLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const save = useMutation({
    mutationFn: () => createPrescription(patient.id, lines, notes, planId ?? null, hasConflict ? override : null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prescriptions', patient.id] }),
  })
  const storeTemplate = useMutation({
    mutationFn: () => saveTemplate(clinicId, templateName ?? '', lines),
    onSuccess: () => { setTemplateName(null); qc.invalidateQueries({ queryKey: ['rx-catalog'] }) },
  })

  if (save.isSuccess) {
    return (
      <Modal title={t('rx.saved')} onClose={onClose}>
        <div className="dialog-actions">
          <Link className="btn btn-primary" to={`/prescriptions/${save.data}`} target="_blank" rel="noreferrer">{t('rx.print')}</Link>
          <button className="btn" onClick={onClose}>{t('common.close')}</button>
        </div>
      </Modal>
    )
  }

  const canSave = lines.length > 0 && lines.every((l) => l.drug_name.trim()) && (!hasConflict || override.trim().length > 0)

  return (
    <Modal title={t('rx.new', { name: patient.full_name })} onClose={onClose}>
      <div className="dialog-form rx-dialog">
        {(patient.allergy_groups.length > 0 || patient.medical_alerts) && (
          <div className="medical-alert compact" role="note">
            <strong>{t('patient.alertTitle')}</strong>
            {patient.allergy_groups.length > 0 && <p>{t('rx.allergicTo', { list: patient.allergy_groups.map(groupLabel).join('، ') })}</p>}
            {patient.medical_alerts && <p>{patient.medical_alerts}</p>}
          </div>
        )}

        <div className="field-row">
          {(catalog.data?.templates.length ?? 0) > 0 && (
            <label className="field"><span>{t('rx.template')}</span>
              <select value="" onChange={(e) => { applyTemplate(e.target.value) }}>
                <option value="" disabled>{t('rx.chooseTemplate')}</option>
                {catalog.data!.templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></label>
          )}
          <label className="field"><span>{t('rx.addDrug')}</span>
            <div className="inline-controls">
              <input list="rx-drugs" dir="ltr" value={pick} onChange={(e) => setPick(e.target.value)} placeholder={t('rx.drugHint')}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPicked() } }} />
              <datalist id="rx-drugs">{drugs.map((d) => <option key={d.id} value={d.name} />)}</datalist>
              <button type="button" className="btn btn-small" onClick={addPicked} disabled={!pick.trim()}>{t('settings.add')}</button>
            </div></label>
        </div>

        {lines.length === 0 && <p className="muted">{t('rx.empty')}</p>}
        <ol className="rx-lines">
          {lines.map((l) => {
            const c = conflictFor(l.drug_id)
            return (
              <li key={l.key} className={c ? 'is-conflict' : ''}>
                <div className="rx-line-head">
                  <strong dir="ltr">{l.drug_name}</strong>
                  <button type="button" className="link-btn danger-link" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>{t('plan.remove')}</button>
                </div>
                {c && (
                  <p className="danger-text">
                    {t(c.source === 'listed' ? 'rx.conflictListed' : 'rx.conflictMentioned', { group: lang === 'ar' ? c.label_ar : c.label_en })}
                  </p>
                )}
                <div className="rx-fields">
                  <input dir="ltr" value={l.dose} onChange={(e) => update(l.key, { dose: e.target.value })} placeholder={t('rx.dose')} aria-label={t('rx.dose')} />
                  <input dir="ltr" value={l.frequency} onChange={(e) => update(l.key, { frequency: e.target.value })} placeholder={t('rx.frequency')} aria-label={t('rx.frequency')} />
                  <input dir="ltr" value={l.duration} onChange={(e) => update(l.key, { duration: e.target.value })} placeholder={t('rx.duration')} aria-label={t('rx.duration')} />
                  <input value={l.notes} onChange={(e) => update(l.key, { notes: e.target.value })} placeholder={t('rx.instructions')} aria-label={t('rx.instructions')} />
                </div>
              </li>
            )
          })}
        </ol>

        <label className="field"><span>{t('rx.notes')}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder={t('rx.notesHint')} /></label>

        {hasConflict && (
          <div className="lock-note">
            <p>{t('rx.overrideExplain')}</p>
            <label className="field"><span>{t('rx.overrideReason')}</span>
              <input value={override} onChange={(e) => setOverride(e.target.value)} maxLength={200} /></label>
          </div>
        )}

        {save.isError && errorKey(save.error) !== 'err.allergyConflict' && <ErrorNote error={save.error} />}
        {storeTemplate.isError && <ErrorNote error={storeTemplate.error} />}

        {templateName !== null && (
          <div className="inline-controls">
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={t('rx.templateName')} autoFocus />
            <button className="btn btn-small btn-primary" disabled={!templateName.trim() || storeTemplate.isPending} onClick={() => storeTemplate.mutate()}>{t('common.save')}</button>
            <button className="link-btn" onClick={() => setTemplateName(null)}>{t('common.cancel')}</button>
          </div>
        )}

        <div className="dialog-actions">
          <button className={`btn ${hasConflict ? 'btn-danger' : 'btn-primary'}`} disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? t('common.saving') : hasConflict ? t('rx.saveAnyway') : t('rx.save')}
          </button>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          {lines.some((l) => l.drug_id) && templateName === null && (
            <button className="link-btn" onClick={() => setTemplateName('')}>{t('rx.saveAsTemplate')}</button>
          )}
        </div>
      </div>
    </Modal>
  )
}
