import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { todayLocal } from '../../lib/dates'
import { PAYMENT_METHODS, type PaymentMethod } from '../payments/api'
import { methodKey } from '../payments/labels'
import { getHistory, getRecipes, recordCount, recordPurchase, recordUsage, saveMaterial, setRecipe, type MaterialStock } from './api'

function useRefresh() {
  const qc = useQueryClient()
  return () => { for (const k of ['materials', 'material-history', 'today', 'finance']) qc.invalidateQueries({ queryKey: [k] }) }
}

export function MaterialForm({ material, onClose }: { material?: MaterialStock; onClose: () => void }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const refresh = useRefresh()
  const [m, setM] = useState({
    name: material?.name ?? '', unit: material?.unit ?? '', min_stock: material?.min_stock ?? 0,
    supplier_name: material?.supplier_name ?? '', supplier_phone: material?.supplier_phone ?? '', active: material?.active ?? true,
  })
  const save = useMutation({
    mutationFn: () => saveMaterial(clinicId, { ...m, id: material?.material_id ?? undefined }),
    onSuccess: () => { refresh(); onClose() },
  })
  return (
    <Modal title={material ? t('mat.edit') : t('mat.new')} onClose={onClose}>
      <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); if (m.name.trim()) save.mutate() }}>
        <label className="field"><span>{t('mat.name')}</span>
          <input required value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder={t('mat.nameHint')} autoFocus /></label>
        <div className="field-row">
          <label className="field"><span>{t('mat.unit')}</span>
            <input value={m.unit} onChange={(e) => setM({ ...m, unit: e.target.value })} placeholder={t('mat.unitHint')} /></label>
          <label className="field"><span>{t('mat.minStock')}</span>
            <input type="number" min={0} step="any" dir="ltr" value={m.min_stock} onChange={(e) => setM({ ...m, min_stock: Number(e.target.value) })} />
            <small className="hint">{t('mat.minStockHint')}</small></label>
        </div>
        <div className="field-row">
          <label className="field"><span>{t('mat.supplier')}</span>
            <input value={m.supplier_name} onChange={(e) => setM({ ...m, supplier_name: e.target.value })} /></label>
          <label className="field"><span>{t('mat.supplierPhone')}</span>
            <input dir="ltr" inputMode="tel" value={m.supplier_phone} onChange={(e) => setM({ ...m, supplier_phone: e.target.value })} /></label>
        </div>
        {material && (
          <label className="check"><input type="checkbox" checked={m.active} onChange={(e) => setM({ ...m, active: e.target.checked })} />
            <span>{t('mat.activeLabel')}</span></label>
        )}
        {save.isError && <ErrorNote error={save.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? t('common.saving') : t('common.save')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function PurchaseDialog({ material, onClose }: { material: MaterialStock; onClose: () => void }) {
  const { t, money } = useI18n()
  const refresh = useRefresh()
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [date, setDate] = useState(todayLocal())
  const [note, setNote] = useState('')
  const q = Number(qty), c = Number(cost)
  const valid = q > 0 && cost !== '' && c >= 0
  const save = useMutation({
    mutationFn: () => recordPurchase(material.material_id!, q, c, method, date, note),
    onSuccess: () => { refresh(); onClose() },
  })
  function onSubmit(e: FormEvent) { e.preventDefault(); if (valid && !save.isPending) save.mutate() }
  return (
    <Modal title={t('mat.purchaseTitle', { name: material.name ?? '' })} onClose={onClose}>
      <form className="dialog-form" onSubmit={onSubmit}>
        <div className="field-row">
          <label className="field"><span>{t('mat.quantity', { unit: material.unit ?? '' })}</span>
            <input type="number" min="0.01" step="any" required dir="ltr" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></label>
          <label className="field"><span>{t('mat.totalCost')}</span>
            <input type="number" min="0" step="any" required dir="ltr" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
        </div>
        {valid && q > 0 && <p className="muted">{t('mat.unitCost', { amount: money(Math.round((c / q) * 100) / 100), unit: material.unit ?? '' })}</p>}
        <div className="field-row">
          <label className="field"><span>{t('pay.method')}</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(methodKey(m))}</option>)}
            </select></label>
          <label className="field"><span>{t('receipt.date')}</span>
            <input type="date" required max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <label className="field"><span>{t('pay.note')}</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></label>
        <p className="hint">{t('mat.purchaseHint')}</p>
        {save.isError && <ErrorNote error={save.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={!valid || save.isPending}>{save.isPending ? t('common.saving') : t('mat.recordPurchase')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function UsageDialog({ material, onClose }: { material: MaterialStock; onClose: () => void }) {
  const { t } = useI18n()
  const refresh = useRefresh()
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const save = useMutation({ mutationFn: () => recordUsage(material.material_id!, Number(qty), note), onSuccess: () => { refresh(); onClose() } })
  return (
    <Modal title={t('mat.useTitle', { name: material.name ?? '' })} onClose={onClose}>
      <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); if (Number(qty) > 0) save.mutate() }}>
        <label className="field"><span>{t('mat.quantity', { unit: material.unit ?? '' })}</span>
          <input type="number" min="0.01" step="any" required dir="ltr" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></label>
        <label className="field"><span>{t('mat.reason')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('mat.reasonHint')} maxLength={200} /></label>
        {save.isError && <ErrorNote error={save.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={!(Number(qty) > 0) || save.isPending}>{t('mat.recordUse')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function CountDialog({ material, onClose }: { material: MaterialStock; onClose: () => void }) {
  const { t } = useI18n()
  const refresh = useRefresh()
  const [counted, setCounted] = useState('')
  const diff = counted === '' ? null : Math.round((Number(counted) - (material.on_hand ?? 0)) * 100) / 100
  const save = useMutation({ mutationFn: () => recordCount(material.material_id!, Number(counted)), onSuccess: () => { refresh(); onClose() } })
  return (
    <Modal title={t('mat.countTitle', { name: material.name ?? '' })} onClose={onClose}>
      <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); if (counted !== '' && Number(counted) >= 0) save.mutate() }}>
        <p className="muted">{t('mat.systemSays', { n: material.on_hand ?? 0, unit: material.unit ?? '' })}</p>
        <label className="field"><span>{t('mat.onShelf')}</span>
          <input type="number" min="0" step="any" required dir="ltr" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus /></label>
        {diff !== null && diff !== 0 && (
          <p className={diff < 0 ? 'warn-text' : 'ok-text'}>{diff < 0 ? t('mat.missing', { n: -diff }) : t('mat.extra', { n: diff })}</p>
        )}
        {save.isError && <ErrorNote error={save.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={counted === '' || save.isPending}>{t('mat.saveCount')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}

export function HistoryDialog({ material, onClose }: { material: MaterialStock; onClose: () => void }) {
  const { t, money, date } = useI18n()
  const q = useQuery({ queryKey: ['material-history', material.material_id], queryFn: () => getHistory(material.material_id!) })
  return (
    <Modal title={t('mat.historyTitle', { name: material.name ?? '' })} onClose={onClose}>
      {q.isError && <ErrorNote error={q.error} />}
      {q.data?.length === 0 && <p className="muted">{t('mat.noHistory')}</p>}
      {q.data && q.data.length > 0 && (
        <div className="table-wrap history-wrap">
          <table className="table table-compact">
            <tbody>
              {q.data.map((mv) => (
                <tr key={mv.id}>
                  <td>{date(mv.occurred_on)}</td>
                  <td>{t(`mat.kind.${mv.kind}` as Parameters<typeof t>[0])}</td>
                  <td className={`num ${mv.quantity < 0 ? 'warn-text' : 'ok-text'}`} dir="ltr">{mv.quantity > 0 ? '+' : ''}{mv.quantity}</td>
                  <td className="num">{mv.total_cost != null ? money(mv.total_cost) : ''}</td>
                  <td className="muted">{mv.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="dialog-actions"><button className="btn" onClick={onClose}>{t('common.close')}</button></div>
    </Modal>
  )
}

/** Owner: which procedures consume this material, and how much each time. */
export function RecipeDialog({ material, onClose }: { material: MaterialStock; onClose: () => void }) {
  const { clinicId, role } = useMember()
  const { t } = useI18n()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['recipes', clinicId], queryFn: () => getRecipes(clinicId) })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: (a: { procedureId: string; qty: number | null }) => setRecipe(clinicId, a.procedureId, material.material_id!, a.qty),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes'] }),
  })
  const current = new Map((q.data?.links ?? []).filter((l) => l.material_id === material.material_id).map((l) => [l.procedure_id, l.quantity]))

  return (
    <Modal title={t('mat.recipeTitle', { name: material.name ?? '' })} onClose={onClose}>
      <p className="muted">{t('mat.recipeHint', { unit: material.unit ?? '' })}</p>
      {q.isError && <ErrorNote error={q.error} />}
      {save.isError && <ErrorNote error={save.error} />}
      <ul className="recipe-list">
        {q.data?.procedures.map((p) => {
          const saved = current.get(p.id)
          const value = drafts[p.id] ?? (saved != null ? String(saved) : '')
          const changed = value !== (saved != null ? String(saved) : '')
          return (
            <li key={p.id}>
              <span>{p.name}</span>
              <input className="cell-input num-input" type="number" min="0" step="any" dir="ltr" value={value} placeholder="0"
                disabled={role !== 'owner'} onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })} />
              {changed && (
                <button className="btn btn-small btn-primary" disabled={save.isPending}
                  onClick={() => save.mutate({ procedureId: p.id, qty: Number(value) > 0 ? Number(value) : null },
                    { onSuccess: () => setDrafts((d) => { const n = { ...d }; delete n[p.id]; return n }) })}>
                  {t('common.save')}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="dialog-actions"><button className="btn" onClick={onClose}>{t('common.close')}</button></div>
    </Modal>
  )
}
