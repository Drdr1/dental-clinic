import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { deleteLabItem, getLabItems, saveLabItem, type LabItem } from '../labs/api'
import { getSettings, saveClinic } from './api'

function Row({ initial, isNew, onDone }: { initial: LabItem; isNew?: boolean; onDone?: () => void }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const [i, setI] = useState(initial)
  const dirty = JSON.stringify(i) !== JSON.stringify(initial)
  const done = () => { qc.invalidateQueries({ queryKey: ['lab-items'] }); onDone?.() }
  const save = useMutation({ mutationFn: () => saveLabItem(clinicId, i), onSuccess: done })
  const remove = useMutation({ mutationFn: () => deleteLabItem(i.id!), onSuccess: done })

  return (
    <>
      <tr className={i.active ? '' : 'is-inactive'}>
        <td><input className="cell-input" value={i.name} onChange={(e) => setI({ ...i, name: e.target.value })}
          placeholder={isNew ? t('labItem.newName') : ''} /></td>
        <td><input className="cell-input num-input" type="number" min={0} step="any" dir="ltr"
          value={i.unit_price} onChange={(e) => setI({ ...i, unit_price: Number(e.target.value) })} /></td>
        <td><input type="checkbox" checked={i.active} onChange={(e) => setI({ ...i, active: e.target.checked })}
          aria-label={t('settings.available')} /></td>
        <td className="num">
          <span className="row-buttons">
            {(dirty || isNew) && (
              <button className="btn btn-small btn-primary" disabled={!i.name.trim() || save.isPending} onClick={() => save.mutate()}>
                {isNew ? t('settings.add') : t('common.save')}
              </button>
            )}
            {!isNew && !dirty && (
              <button className="link-btn danger-link" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {t('file.delete')}
              </button>
            )}
          </span>
        </td>
      </tr>
      {(save.isError || remove.isError) && (
        <tr><td colSpan={4}><ErrorNote error={save.error ?? remove.error} /></td></tr>
      )}
    </>
  )
}

/** What the lab charges per unit, and how long each stage of a case may take. */
export function LabItemsSection() {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const [k, setK] = useState(0)
  const q = useQuery({ queryKey: ['lab-items', clinicId], queryFn: () => getLabItems(clinicId) })
  const settings = useQuery({ queryKey: ['settings', clinicId], queryFn: () => getSettings(clinicId) })
  const [days, setDays] = useState<number | null>(null)
  const current = days ?? settings.data?.clinic.lab_stage_days ?? 2
  const saveDays = useMutation({
    mutationFn: () => saveClinic(clinicId, { ...settings.data!.clinic, lab_stage_days: current }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['lab-cases'] }) },
  })

  return (
    <section className="panel">
      <h2>{t('labItem.title')}</h2>
      <p className="muted">{t('labItem.hint')}</p>
      {q.isError && <ErrorNote error={q.error} />}
      <div className="table-wrap">
        <table className="table table-compact">
          <thead><tr>
            <th>{t('labItem.name')}</th><th>{t('labItem.unitPrice')}</th>
            <th>{t('settings.available')}</th><th />
          </tr></thead>
          <tbody>
            {q.data?.map((i) => <Row key={JSON.stringify(i)} initial={i} />)}
            <Row key={`new-${k}`} isNew initial={{ name: '', unit_price: 0, active: true }}
              onDone={() => setK((x) => x + 1)} />
          </tbody>
        </table>
      </div>

      <label className="field">
        <span>{t('labItem.stageDays')}</span>
        <span className="inline-controls">
          <input type="number" className="inline-number" min={1} max={30} dir="ltr" value={current}
            onChange={(e) => setDays(Number(e.target.value))} />
          {days != null && days !== settings.data?.clinic.lab_stage_days && (
            <button className="btn btn-small btn-primary" disabled={saveDays.isPending} onClick={() => saveDays.mutate()}>
              {t('common.save')}
            </button>
          )}
        </span>
        <small className="hint">{t('labItem.stageDaysHint')}</small>
      </label>
      {saveDays.isError && <ErrorNote error={saveDays.error} />}
    </section>
  )
}
