import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { templates, waMessage } from '../../lib/whatsapp'
import { getMaterialSummary, getStock, recordCount, type MaterialStock } from './api'
import { CountDialog, HistoryDialog, MaterialForm, PurchaseDialog, RecipeDialog, UsageDialog } from './MaterialDialogs'

type Open = { kind: 'new' } | { kind: 'edit' | 'buy' | 'use' | 'count' | 'history' | 'recipe'; m: MaterialStock } | null

type Chip = 'all' | 'low' | 'inactive'

export function MaterialsPage() {
  const { clinicId, clinicName, role } = useMember()
  const { t, money } = useI18n()
  const qc = useQueryClient()
  const [open, setOpen] = useState<Open>(null)
  const [chip, setChip] = useState<Chip>('all')
  const [search, setSearch] = useState('')
  const [counting, setCounting] = useState<Record<string, string> | null>(null)
  const q = useQuery({ queryKey: ['materials', clinicId], queryFn: () => getStock(clinicId) })
  const summary = useQuery({ queryKey: ['materials-summary', clinicId], queryFn: () => getMaterialSummary(clinicId) })

  const all = q.data ?? []
  const low = all.filter((m) => m.is_low && m.active)
  const inactive = all.filter((m) => !m.active)
  const rows = all
    .filter((m) => chip === 'all' ? m.active : chip === 'low' ? m.is_low && m.active : !m.active)
    .filter((m) => !search.trim() || (m.name ?? '').toLowerCase().includes(search.trim().toLowerCase()))
    // Running out first: the lowest stock against its minimum at the top.
    .sort((a, b) => Number(b.is_low) - Number(a.is_low) || (a.on_hand ?? 0) / Math.max(1, a.min_stock ?? 1) - (b.on_hand ?? 0) / Math.max(1, b.min_stock ?? 1))
  const stockValue = all.filter((m) => m.active).reduce((s, m) => s + Math.max(0, m.on_hand ?? 0) * (m.last_unit_cost ?? 0), 0)
  const daysSince = summary.data?.lastCount
    ? Math.round((Date.now() - new Date(`${summary.data.lastCount}T12:00:00`).getTime()) / 86_400_000) : null

  // Whole-shelf count: type what is actually there, save only what changed.
  const saveCount = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      for (const m of all) {
        const v = values[m.material_id ?? '']
        if (v === undefined || v.trim() === '') continue
        const n = Number(v)
        if (Number.isFinite(n) && n >= 0 && n !== m.on_hand) await recordCount(m.material_id!, n)
      }
    },
    onSuccess: () => {
      setCounting(null)
      for (const k of ['materials', 'materials-summary', 'today']) qc.invalidateQueries({ queryKey: [k] })
    },
  })

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{t('mat.title')}</h1>
          <p className="muted">{t('mat.countN', { n: all.filter((m) => m.active).length })}</p>
        </div>
        <div className="row-buttons">
          <button className="btn" onClick={() => setCounting({})}>{t('mat.fullCount')}</button>
          <button className="btn btn-primary" onClick={() => setOpen({ kind: 'new' })}>{t('mat.new')}</button>
        </div>
      </header>

      <div className="kpis">
        <article className="kpi">
          <div className="kpi-top"><span>{t('mat.kpiLow')}</span></div>
          <strong className={`kpi-value${low.length ? ' is-danger' : ''}`}>{low.length}</strong>
          <p className="kpi-sub">{low.slice(0, 3).map((m) => m.name).join('، ') || t('mat.allStocked')}</p>
        </article>
        <article className="kpi">
          <div className="kpi-top"><span>{t('mat.kpiValue')}</span></div>
          <strong className="kpi-value">{money(stockValue)}</strong>
          <p className="kpi-sub">{t('mat.kpiValueSub')}</p>
        </article>
        <article className="kpi">
          <div className="kpi-top"><span>{t('mat.kpiBuys')}</span></div>
          <strong className="kpi-value">{money(summary.data?.monthBuys ?? 0)}</strong>
          <p className="kpi-sub">{t('mat.kpiBuysSub', { n: summary.data?.monthBuyCount ?? 0 })}</p>
        </article>
        <article className="kpi">
          <div className="kpi-top"><span>{t('mat.kpiCount')}</span></div>
          <strong className="kpi-value">{daysSince == null ? '—' : daysSince === 0 ? t('today.today') : t('mat.daysAgo', { n: daysSince })}</strong>
          <p className="kpi-sub">{daysSince == null ? t('mat.neverCounted') : t('mat.countDiff', { n: summary.data?.lastCountDiff ?? 0 })}</p>
        </article>
      </div>

      <section className="panel list-panel">
        <div className="list-tools">
          <label className="search-box">
            <Icon name="search" />
            <input type="search" placeholder={t('mat.search')} aria-label={t('mat.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="chips">
            <button className={`chip chip-lg${chip === 'all' ? ' on' : ''}`} onClick={() => setChip('all')}>{t('patients.filter.all')} {all.length - inactive.length}</button>
            <button className={`chip chip-lg${chip === 'low' ? ' on' : ''}`} onClick={() => setChip('low')}>{t('mat.chipLow', { n: low.length })}</button>
            {inactive.length > 0 && <button className={`chip chip-lg${chip === 'inactive' ? ' on' : ''}`} onClick={() => setChip('inactive')}>{t('mat.chipInactive', { n: inactive.length })}</button>}
          </div>
        </div>

        {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
        {q.isPending && <Skeleton rows={5} variant="table" />}
        {q.data?.length === 0 && <p className="empty">{t('mat.empty')}</p>}

        {rows.length > 0 && (
          <div className="table-scroll">
            <table className="table table-plain">
              <thead>
                <tr>
                  <th>{t('mat.name')}</th>
                  <th>{t('mat.onHand')}</th>
                  <th className="hide-phone">{t('mat.minStock')}</th>
                  <th className="hide-phone">{t('mat.lastCostUnit')}</th>
                  <th className="hide-phone">{t('mat.supplier')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const fill = Math.min(100, ((m.on_hand ?? 0) / Math.max(1, (m.min_stock ?? 0) * 2.5)) * 100)
                  return (
                    <tr key={m.material_id} className="hover-row">
                      <td>
                        <button className="link-btn row-link strong" onClick={() => setOpen({ kind: 'history', m })}>{m.name}</button>
                        {!m.active && <span className="badge badge-muted"> {t('mat.inactive')}</span>}
                      </td>
                      <td>
                        <div className="stock-cell">
                          <span className={m.is_low ? 'late-text' : 'strong'}>{m.on_hand} {m.unit}</span>
                          <div className={`kpi-bar${m.is_low ? ' is-bad' : ''}`}><span style={{ width: `${Math.max(fill, m.on_hand ? 4 : 0)}%` }} /></div>
                        </div>
                      </td>
                      <td className="hide-phone">{m.min_stock} {m.unit}</td>
                      <td className="hide-phone nowrap">{m.last_unit_cost != null ? money(m.last_unit_cost) : '—'}</td>
                      <td className="hide-phone">{m.supplier_name ?? '—'}</td>
                      <td>
                        <span className="row-buttons mat-actions">
                          {m.is_low && m.supplier_phone && (
                            <a className="btn btn-small btn-ink" target="_blank" rel="noreferrer"
                              href={waMessage(m.supplier_phone, templates.orderMaterial({ clinic: clinicName, material: m.name ?? '', unit: m.unit ?? '' }))}>
                              {t('mat.orderShort')}
                            </a>
                          )}
                          <button className="btn btn-small" onClick={() => setOpen({ kind: 'buy', m })}>{t('mat.buy')}</button>
                          <button className="btn btn-small" onClick={() => setOpen({ kind: 'use', m })}>{t('mat.use')}</button>
                          <button className="btn btn-small" onClick={() => setOpen({ kind: 'count', m })}>{t('mat.count')}</button>
                          <span className="row-hover-action mat-links">
                            <button className="link-btn small" onClick={() => setOpen({ kind: 'edit', m })}>{t('mat.editShort')}</button>
                            {role === 'owner' && <button className="link-btn small" onClick={() => setOpen({ kind: 'recipe', m })}>{t('mat.recipe')}</button>}
                          </span>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {counting && (
        <Modal title={t('mat.fullCount')} onClose={() => setCounting(null)}>
          <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); saveCount.mutate(counting) }}>
            <p className="hint">{t('mat.fullCountHint')}</p>
            <div className="count-grid">
              {all.filter((m) => m.active).map((m) => (
                <label key={m.material_id} className="count-row">
                  <span>{m.name} <span className="muted small">({t('mat.systemSays', { n: m.on_hand ?? 0, unit: m.unit ?? '' })})</span></span>
                  <input type="number" min="0" step="any" dir="ltr" className="inline-number" placeholder={String(m.on_hand ?? 0)}
                    value={counting[m.material_id ?? ''] ?? ''}
                    onChange={(e) => setCounting({ ...counting, [m.material_id ?? '']: e.target.value })} />
                </label>
              ))}
            </div>
            {saveCount.isError && <ErrorNote error={saveCount.error} />}
            <div className="dialog-actions">
              <button type="submit" className="btn btn-primary" disabled={saveCount.isPending}>{saveCount.isPending ? t('common.saving') : t('common.save')}</button>
              <button type="button" className="btn" onClick={() => setCounting(null)}>{t('common.cancel')}</button>
            </div>
          </form>
        </Modal>
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
