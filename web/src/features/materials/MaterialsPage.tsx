import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { templates, waMessage } from '../../lib/whatsapp'
import { getStock, type MaterialStock } from './api'
import { CountDialog, HistoryDialog, MaterialForm, PurchaseDialog, RecipeDialog, UsageDialog } from './MaterialDialogs'

type Open = { kind: 'new' } | { kind: 'edit' | 'buy' | 'use' | 'count' | 'history' | 'recipe'; m: MaterialStock } | null

export function MaterialsPage() {
  const { clinicId, clinicName, role } = useMember()
  const { t, money, date } = useI18n()
  const [open, setOpen] = useState<Open>(null)
  const [lowOnly, setLowOnly] = useState(false)
  const [search, setSearch] = useState('')
  const q = useQuery({ queryKey: ['materials', clinicId], queryFn: () => getStock(clinicId) })

  const rows = (q.data ?? [])
    .filter((m) => !lowOnly || m.is_low)
    .filter((m) => !search.trim() || (m.name ?? '').toLowerCase().includes(search.trim().toLowerCase()))
  const lowCount = (q.data ?? []).filter((m) => m.is_low).length

  return (
    <section className="page">
      <header className="page-head">
        <h1>{t('mat.title')}</h1>
        <button className="btn btn-primary" onClick={() => setOpen({ kind: 'new' })}>{t('mat.new')}</button>
      </header>

      <div className="toolbar">
        <input className="search" type="search" placeholder={t('mat.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          <span>{t('mat.lowOnly', { n: lowCount })}</span>
        </label>
      </div>

      {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <p className="empty">{t('mat.empty')}</p>}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('mat.name')}</th>
                <th className="num">{t('mat.onHand')}</th>
                <th className="num">{t('mat.minStock')}</th>
                <th className="num">{t('mat.lastCost')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.material_id} className={m.active ? '' : 'is-inactive'}>
                  <td>
                    <button className="link-btn row-link strong" onClick={() => setOpen({ kind: 'history', m })}>{m.name}</button>
                    {m.is_low && <span className="badge badge-warn"> {t('mat.low')}</span>}
                    {!m.active && <span className="badge badge-muted"> {t('mat.inactive')}</span>}
                    {m.supplier_name && <p className="muted small">{m.supplier_name}</p>}
                  </td>
                  <td className={`num ${m.is_low ? 'warn-text' : ''}`}><strong>{m.on_hand}</strong> <span className="muted">{m.unit}</span></td>
                  <td className="num muted">{m.min_stock}</td>
                  <td className="num">
                    {m.last_unit_cost != null ? money(m.last_unit_cost) : t('common.none')}
                    {m.last_purchase_on && <p className="muted small">{date(m.last_purchase_on)}</p>}
                  </td>
                  <td className="num">
                    <span className="row-buttons">
                      <button className="btn btn-small btn-primary" onClick={() => setOpen({ kind: 'buy', m })}>{t('mat.buy')}</button>
                      <button className="btn btn-small" onClick={() => setOpen({ kind: 'use', m })}>{t('mat.use')}</button>
                      <button className="btn btn-small" onClick={() => setOpen({ kind: 'count', m })}>{t('mat.count')}</button>
                      {m.is_low && m.supplier_phone && (
                        <a className="btn btn-small" target="_blank" rel="noreferrer"
                          href={waMessage(m.supplier_phone, templates.orderMaterial({ clinic: clinicName, material: m.name ?? '', unit: m.unit ?? '' }))}>
                          {t('mat.order')}
                        </a>
                      )}
                      <button className="link-btn" onClick={() => setOpen({ kind: 'edit', m })}>{t('mat.editShort')}</button>
                      {role === 'owner' && (
                        <button className="link-btn" onClick={() => setOpen({ kind: 'recipe', m })}>{t('mat.recipe')}</button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open?.kind === 'new' && <MaterialForm onClose={() => setOpen(null)} />}
      {open?.kind === 'edit' && <MaterialForm material={open.m} onClose={() => setOpen(null)} />}
      {open?.kind === 'buy' && <PurchaseDialog material={open.m} onClose={() => setOpen(null)} />}
      {open?.kind === 'use' && <UsageDialog material={open.m} onClose={() => setOpen(null)} />}
      {open?.kind === 'count' && <CountDialog material={open.m} onClose={() => setOpen(null)} />}
      {open?.kind === 'history' && <HistoryDialog material={open.m} onClose={() => setOpen(null)} />}
      {open?.kind === 'recipe' && <RecipeDialog material={open.m} onClose={() => setOpen(null)} />}
    </section>
  )
}
