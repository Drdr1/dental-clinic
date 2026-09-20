import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'

type Payer = { id?: string; name: string; discount_percent: number; phone: string | null; active: boolean }

async function listPayers(clinicId: string): Promise<Required<Payer>[]> {
  const { data, error } = await supabase.from('payers').select('id, name, discount_percent, phone, active')
    .eq('clinic_id', clinicId).order('name')
  if (error) throw error
  return data as Required<Payer>[]
}

async function savePayer(clinicId: string, p: Payer) {
  const row = { name: p.name.trim(), discount_percent: p.discount_percent, phone: p.phone?.trim() || null, active: p.active }
  const { error } = p.id
    ? await supabase.from('payers').update(row).eq('id', p.id)
    : await supabase.from('payers').insert({ ...row, clinic_id: clinicId })
  if (error) throw error
}

function Row({ initial, isNew, onDone }: { initial: Payer; isNew?: boolean; onDone?: () => void }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const [p, setP] = useState(initial)
  const dirty = JSON.stringify(p) !== JSON.stringify(initial)
  const save = useMutation({
    mutationFn: () => savePayer(clinicId, p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payers'] }); onDone?.() },
  })
  return (
    <>
      <tr className={p.active ? '' : 'is-inactive'}>
        <td><input className="cell-input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })}
          placeholder={isNew ? t('payer.newName') : ''} /></td>
        <td><input className="cell-input num-input" type="number" min={0} max={100} step={1} dir="ltr"
          value={p.discount_percent} onChange={(e) => setP({ ...p, discount_percent: Number(e.target.value) })} /></td>
        <td><input className="cell-input" dir="ltr" value={p.phone ?? ''} onChange={(e) => setP({ ...p, phone: e.target.value })} /></td>
        <td><input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })}
          aria-label={t('settings.available')} /></td>
        <td className="num">
          {(dirty || isNew) && (
            <button className="btn btn-small btn-primary" disabled={!p.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {isNew ? t('settings.add') : t('common.save')}
            </button>
          )}
        </td>
      </tr>
      {save.isError && <tr><td colSpan={5}><ErrorNote error={save.error} /></td></tr>}
    </>
  )
}

export function PayersSection() {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const [k, setK] = useState(0)
  const q = useQuery({ queryKey: ['payers', clinicId], queryFn: () => listPayers(clinicId) })
  return (
    <section className="panel">
      <h2>{t('payer.title')}</h2>
      <p className="muted">{t('payer.hint')}</p>
      {q.isError && <ErrorNote error={q.error} />}
      <div className="table-wrap">
        <table className="table table-compact">
          <thead><tr>
            <th>{t('payer.name')}</th><th>{t('payer.discount')}</th><th>{t('mat.supplierPhone')}</th>
            <th>{t('settings.available')}</th><th />
          </tr></thead>
          <tbody>
            {q.data?.map((p) => <Row key={JSON.stringify(p)} initial={p} />)}
            <Row key={`new-${k}`} isNew initial={{ name: '', discount_percent: 10, phone: '', active: true }}
              onDone={() => setK((x) => x + 1)} />
          </tbody>
        </table>
      </div>
    </section>
  )
}
