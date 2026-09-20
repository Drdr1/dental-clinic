import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { getAllergyGroups, setPatientAllergies } from './api'

/** Structured allergies shown as chips; the prescription check relies on these (plus the free-text alert). */
export function PatientAllergies({ patientId, groups }: { patientId: string; groups: string[] }) {
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const all = useQuery({ queryKey: ['allergy-groups'], queryFn: getAllergyGroups, staleTime: Infinity })
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set(groups))
  const label = (code: string) => {
    const g = all.data?.find((x) => x.code === code)
    return g ? (lang === 'ar' ? g.label_ar : g.label_en) : code
  }
  const save = useMutation({
    mutationFn: () => setPatientAllergies(patientId, [...picked]),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient', patientId] }); setEditing(false) },
  })

  return (
    <div className="allergies">
      <span className="allergies-label">{t('rx.allergies')}</span>
      {groups.length === 0 && <span className="muted">{t('rx.noAllergies')}</span>}
      {groups.map((g) => <span key={g} className="badge badge-danger">{label(g)}</span>)}
      <button className="link-btn" onClick={() => { setPicked(new Set(groups)); setEditing(true) }}>{t('rx.editAllergies')}</button>

      {editing && (
        <Modal title={t('rx.allergies')} onClose={() => setEditing(false)}>
          <div className="dialog-form">
            <p className="muted">{t('rx.allergiesHint')}</p>
            <div className="choice-row">
              {all.data?.map((g) => (
                <label key={g.code} className={`choice ${picked.has(g.code) ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={picked.has(g.code)} onChange={() => setPicked((p) => {
                    const n = new Set(p); if (n.has(g.code)) n.delete(g.code); else n.add(g.code); return n
                  })} />
                  {lang === 'ar' ? g.label_ar : g.label_en}
                </label>
              ))}
            </div>
            {save.isError && <ErrorNote error={save.error} />}
            <div className="dialog-actions">
              <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</button>
              <button className="btn" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
