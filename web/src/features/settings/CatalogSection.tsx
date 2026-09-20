import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { saveChair, saveProcedure } from './api'

type Procedure = { id?: string; name: string; default_price: number; default_duration_min: number; active: boolean }
type Chair = { id?: string; name: string; active: boolean }

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    for (const k of ['settings', 'plan', 'calendar']) queryClient.invalidateQueries({ queryKey: [k] })
  }
}

function ProcedureRow({ initial, isNew, onDone }: { initial: Procedure; isNew?: boolean; onDone?: () => void }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const invalidate = useInvalidate()
  const [p, setP] = useState(initial)
  const dirty = JSON.stringify(p) !== JSON.stringify(initial)
  const valid = p.name.trim().length > 0 && p.default_price >= 0 && p.default_duration_min > 0

  const save = useMutation({
    mutationFn: () => saveProcedure(clinicId, p),
    onSuccess: () => { invalidate(); onDone?.() },
  })

  return (
    <>
      <tr className={p.active ? '' : 'is-inactive'}>
        <td><input className="cell-input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })}
          placeholder={isNew ? t('settings.newProcedure') : ''} aria-label={t('plan.procedure')} /></td>
        <td><input className="cell-input num-input" type="number" min={0} step={1} dir="ltr" value={p.default_price}
          onChange={(e) => setP({ ...p, default_price: Number(e.target.value) })} aria-label={t('plan.col.price')} /></td>
        <td><input className="cell-input num-input" type="number" min={5} step={5} dir="ltr" value={p.default_duration_min}
          onChange={(e) => setP({ ...p, default_duration_min: Number(e.target.value) })} aria-label={t('appt.duration')} /></td>
        <td>
          <label className="check">
            <input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} />
            <span>{t('settings.available')}</span>
          </label>
        </td>
        <td className="num">
          {(dirty || isNew) && (
            <button className="btn btn-small btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
              {isNew ? t('settings.add') : t('common.save')}
            </button>
          )}
        </td>
      </tr>
      {save.isError && <tr><td colSpan={5}><ErrorNote error={save.error} /></td></tr>}
    </>
  )
}

export function ProceduresSection({ procedures }: { procedures: Required<Procedure>[] }) {
  const { t } = useI18n()
  const [newKey, setNewKey] = useState(0)
  return (
    <section className="panel">
      <h2>{t('settings.procedures')}</h2>
      <p className="muted">{t('settings.proceduresHint')}</p>
      <div className="table-wrap">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>{t('plan.procedure')}</th>
              <th>{t('settings.price')}</th>
              <th>{t('settings.durationMin')}</th>
              <th>{t('plan.col.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {procedures.map((p) => <ProcedureRow key={`${p.id}-${p.default_price}-${p.name}-${p.active}-${p.default_duration_min}`} initial={p} />)}
            <ProcedureRow key={`new-${newKey}`} isNew
              initial={{ name: '', default_price: 0, default_duration_min: 30, active: true }}
              onDone={() => setNewKey((k) => k + 1)} />
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ChairRow({ initial, isNew, onDone }: { initial: Chair; isNew?: boolean; onDone?: () => void }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const invalidate = useInvalidate()
  const [c, setC] = useState(initial)
  const dirty = JSON.stringify(c) !== JSON.stringify(initial)
  const save = useMutation({ mutationFn: () => saveChair(clinicId, c), onSuccess: () => { invalidate(); onDone?.() } })
  return (
    <li className="chair-row">
      <input className="cell-input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })}
        placeholder={isNew ? t('settings.newChair') : ''} aria-label={t('appt.chair')} />
      <label className="check">
        <input type="checkbox" checked={c.active} onChange={(e) => setC({ ...c, active: e.target.checked })} />
        <span>{t('settings.inUse')}</span>
      </label>
      {(dirty || isNew) && (
        <button className="btn btn-small btn-primary" disabled={!c.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {isNew ? t('settings.add') : t('common.save')}
        </button>
      )}
      {save.isError && <ErrorNote error={save.error} />}
    </li>
  )
}

export function ChairsSection({ chairs }: { chairs: Required<Chair>[] }) {
  const { t } = useI18n()
  const [newKey, setNewKey] = useState(0)
  return (
    <section className="panel">
      <h2>{t('settings.chairs')}</h2>
      <p className="muted">{t('settings.chairsHint')}</p>
      <ul className="chair-list">
        {chairs.map((c) => <ChairRow key={`${c.id}-${c.name}-${c.active}`} initial={c} />)}
        <ChairRow key={`new-${newKey}`} isNew initial={{ name: '', active: true }} onDone={() => setNewKey((k) => k + 1)} />
      </ul>
    </section>
  )
}
