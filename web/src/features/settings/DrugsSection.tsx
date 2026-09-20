import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { getAllergyGroups, getCatalog, saveDrug, type Drug } from '../prescriptions/api'

const empty: Drug = {
  id: '', name: '', generic_name: '', form: '', allergy_group: null, default_dose: '', default_frequency: '',
  default_duration: '', default_notes: '', active: true,
}

function DrugRow({ initial, isNew, onDone }: { initial: Drug; isNew?: boolean; onDone?: () => void }) {
  const { clinicId } = useMember()
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const groups = useQuery({ queryKey: ['allergy-groups'], queryFn: getAllergyGroups, staleTime: Infinity })
  const [d, setD] = useState(initial)
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  const save = useMutation({
    mutationFn: () => saveDrug(clinicId, { ...d, id: d.id || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rx-catalog'] }); onDone?.() },
  })
  const f = (k: keyof Drug) => ({
    value: (d[k] as string | null) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value }),
  })
  return (
    <>
      <tr className={d.active ? '' : 'is-inactive'}>
        <td><input className="cell-input" dir="ltr" {...f('name')} placeholder={isNew ? t('rx.newDrug') : ''} /></td>
        <td>
          <select className="cell-select" value={d.allergy_group ?? ''} onChange={(e) => setD({ ...d, allergy_group: e.target.value || null })}>
            <option value="">—</option>
            {groups.data?.map((g) => <option key={g.code} value={g.code}>{lang === 'ar' ? g.label_ar : g.label_en}</option>)}
          </select>
        </td>
        <td><input className="cell-input" dir="ltr" {...f('default_dose')} /></td>
        <td><input className="cell-input" dir="ltr" {...f('default_frequency')} /></td>
        <td><input className="cell-input" dir="ltr" {...f('default_duration')} /></td>
        <td><input className="cell-input" {...f('default_notes')} /></td>
        <td><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} aria-label={t('settings.available')} /></td>
        <td className="num">
          {(dirty || isNew) && (
            <button className="btn btn-small btn-primary" disabled={!d.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {isNew ? t('settings.add') : t('common.save')}
            </button>
          )}
        </td>
      </tr>
      {save.isError && <tr><td colSpan={8}><ErrorNote error={save.error} /></td></tr>}
    </>
  )
}

export function DrugsSection() {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const q = useQuery({ queryKey: ['rx-catalog', clinicId], queryFn: () => getCatalog(clinicId) })
  const [k, setK] = useState(0)
  return (
    <section className="panel">
      <h2>{t('rx.catalog')}</h2>
      <p className="muted">{t('rx.catalogHint')}</p>
      {q.isError && <ErrorNote error={q.error} />}
      <div className="table-wrap">
        <table className="table table-compact">
          <thead><tr>
            <th>{t('rx.drug')}</th><th>{t('rx.allergyGroup')}</th><th>{t('rx.dose')}</th><th>{t('rx.frequency')}</th>
            <th>{t('rx.duration')}</th><th>{t('rx.instructions')}</th><th>{t('settings.available')}</th><th />
          </tr></thead>
          <tbody>
            {q.data?.drugs.map((d) => <DrugRow key={JSON.stringify(d)} initial={d} />)}
            <DrugRow key={`new-${k}`} isNew initial={empty} onDone={() => setK((x) => x + 1)} />
          </tbody>
        </table>
      </div>
    </section>
  )
}
