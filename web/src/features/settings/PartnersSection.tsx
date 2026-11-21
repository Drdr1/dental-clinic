import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { deletePartner, listPartners, savePartner, type Partner } from '../finance/api'

function Row({ initial, isNew, onDone }: { initial: Partner; isNew?: boolean; onDone?: () => void }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const [p, setP] = useState(initial)
  const dirty = JSON.stringify(p) !== JSON.stringify(initial)
  const done = () => { qc.invalidateQueries({ queryKey: ['partners'] }); qc.invalidateQueries({ queryKey: ['finance'] }); onDone?.() }
  const save = useMutation({ mutationFn: () => savePartner(clinicId, p), onSuccess: done })
  const remove = useMutation({ mutationFn: () => deletePartner(p.id!), onSuccess: done })

  return (
    <>
      <tr className={p.active ? '' : 'is-inactive'}>
        <td><input className="cell-input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })}
          placeholder={isNew ? t('partner.newName') : ''} /></td>
        <td><input className="cell-input num-input" type="number" min={0} max={100} step="any" dir="ltr"
          value={p.share_percent} onChange={(e) => setP({ ...p, share_percent: Number(e.target.value) })} /></td>
        <td><input className="cell-input" value={p.note ?? ''} onChange={(e) => setP({ ...p, note: e.target.value })} maxLength={120} /></td>
        <td><input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })}
          aria-label={t('settings.available')} /></td>
        <td className="num">
          <span className="row-buttons">
            {(dirty || isNew) && (
              <button className="btn btn-small btn-primary" disabled={!p.name.trim() || save.isPending} onClick={() => save.mutate()}>
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
        <tr><td colSpan={5}><ErrorNote error={save.error ?? remove.error} /></td></tr>
      )}
    </>
  )
}

/** Who owns the clinic, and how the month's profit is divided between them. */
export function PartnersSection() {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const [k, setK] = useState(0)
  const q = useQuery({ queryKey: ['partners', clinicId], queryFn: () => listPartners(clinicId) })
  const total = (q.data ?? []).filter((p) => p.active).reduce((s, p) => s + Number(p.share_percent), 0)

  return (
    <section className="panel">
      <h2>{t('partner.title')}</h2>
      <p className="muted">{t('partner.hint')}</p>
      {q.isError && <ErrorNote error={q.error} />}
      <div className="table-wrap">
        <table className="table table-compact">
          <thead><tr>
            <th>{t('partner.name')}</th><th>{t('partner.share')}</th><th>{t('pay.note')}</th>
            <th>{t('settings.available')}</th><th />
          </tr></thead>
          <tbody>
            {q.data?.map((p) => <Row key={JSON.stringify(p)} initial={p} />)}
            <Row key={`new-${k}`} isNew initial={{ name: '', share_percent: 0, active: true, note: '' }}
              onDone={() => setK((x) => x + 1)} />
          </tbody>
        </table>
      </div>
      {q.data && q.data.length > 0 && (
        <p className={Math.abs(total - 100) > 0.01 ? 'danger-text small' : 'muted small'}>
          {t('partner.total', { total })}
        </p>
      )}
    </section>
  )
}
