import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { addItems, type Procedure } from '../plans/api'
import { DictateBox } from './DictateBox'
import { draftPlan, type DraftLine } from './api'

type Props = { planId: string; procedures: Procedure[]; onClose: () => void }

type Row = DraftLine & { key: number; teethText: string; priceText: string }

const VALID = /^(1[1-8]|2[1-8]|3[1-8]|4[1-8])$/

/** "16، 26 36" → [16, 26, 36]; anything that is not a real tooth number is reported. */
function parseTeeth(text: string): { teeth: number[]; bad: string[] } {
  const parts = text.split(/[\s,،؛;+و-]+/).map((x) => x.trim()).filter(Boolean)
  const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  const teeth: number[] = [], bad: string[] = []
  for (const p of parts.map(toLatin)) {
    if (VALID.test(p)) teeth.push(Number(p))
    else bad.push(p)
  }
  return { teeth: [...new Set(teeth)].sort((a, b) => a - b), bad }
}

/**
 * Dictate the plan, read it back as lines, fix anything, then add. The model
 * only proposes: every line here is editable, and nothing reaches the plan
 * until "add" — through the same insert the manual form uses.
 */
export function DictatePlanDialog({ planId, procedures, onClose }: Props) {
  const { clinicId } = useMember()
  const { t, money } = useI18n()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [unclear, setUnclear] = useState<string[]>([])

  const understand = useMutation({
    mutationFn: () => draftPlan(clinicId, text),
    onSuccess: (d) => {
      setRows(d.lines.map((l, i) => ({ ...l, key: i, teethText: l.teeth.join('، '), priceText: String(l.price) })))
      setUnclear(d.unclear)
    },
  })

  const parsed = (rows ?? []).map((r) => ({ r, ...parseTeeth(r.teethText), price: Number(r.priceText) }))
  const invalid = parsed.some((p) => p.bad.length || !p.r.procedureId || p.r.priceText === '' || !Number.isFinite(p.price) || p.price < 0)
  const lineCount = parsed.reduce((n, p) => n + Math.max(p.teeth.length, 1), 0)
  const total = parsed.reduce((n, p) => n + Math.max(p.teeth.length, 1) * (p.price || 0), 0)

  const add = useMutation({
    mutationFn: () => addItems(clinicId, planId, parsed.flatMap((p) =>
      (p.teeth.length ? p.teeth : [null]).map((tooth) => ({
        procedureId: p.r.procedureId, tooth, price: p.price, description: p.r.note.trim() || null,
      })))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', planId] })
      onClose()
    },
  })

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  function chooseProcedure(key: number, id: string) {
    const p = procedures.find((x) => x.id === id)
    update(key, { procedureId: id, procedureName: p?.name ?? '', ...(p ? { priceText: String(p.default_price), priceSaid: false } : {}) })
  }

  return (
    <Modal title={t('dict.planTitle')} onClose={onClose}>
      <div className="dialog-form">
        <DictateBox value={text} onChange={setText} placeholder={t('dict.planPlaceholder')} />
        <div className="row-buttons">
          <button type="button" className="btn btn-primary" disabled={!text.trim() || understand.isPending}
            onClick={() => understand.mutate()}>
            {understand.isPending ? t('dict.understanding') : rows ? t('dict.again') : t('dict.toLines')}
          </button>
        </div>
        {understand.isError && <ErrorNote error={understand.error} />}

        {unclear.length > 0 && (
          <div className="warn-note" role="status">
            <strong>{t('dict.unclear')}</strong>
            <ul>{unclear.map((u, i) => <li key={i}>{u}</li>)}</ul>
          </div>
        )}

        {rows && rows.length === 0 && <p className="muted">{t('dict.noLines')}</p>}

        {rows && rows.length > 0 && (
          <div className="draft-lines">
            {parsed.map(({ r, bad }) => (
              <div key={r.key} className="draft-line">
                <label className="field">
                  <span>{t('plan.procedure')}</span>
                  <select value={r.procedureId} onChange={(e) => chooseProcedure(r.key, e.target.value)}>
                    {procedures.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>{t('plan.teeth')}</span>
                  <input dir="ltr" value={r.teethText} onChange={(e) => update(r.key, { teethText: e.target.value })}
                    placeholder={t('dict.noTooth')} aria-invalid={bad.length > 0} />
                  {bad.length > 0 && <small className="error-text">{t('dict.badTooth', { list: bad.join('، ') })}</small>}
                </label>
                <label className="field">
                  <span>{t('plan.pricePerTooth')}</span>
                  <input type="number" min="0" step="0.01" dir="ltr" value={r.priceText}
                    onChange={(e) => update(r.key, { priceText: e.target.value, priceSaid: true })} />
                  {r.priceSaid && <small className="hint">{t('dict.priceSaid')}</small>}
                </label>
                <label className="field">
                  <span>{t('plan.itemNote')}</span>
                  <input value={r.note} maxLength={120} onChange={(e) => update(r.key, { note: e.target.value })} />
                </label>
                <button type="button" className="btn btn-small draft-remove"
                  onClick={() => setRows((rs) => rs!.filter((x) => x.key !== r.key))}>{t('dict.remove')}</button>
              </div>
            ))}
          </div>
        )}

        {add.isError && <ErrorNote error={add.error} />}

        <div className="dialog-actions">
          {rows && rows.length > 0 && (
            <button type="button" className="btn btn-primary" disabled={invalid || add.isPending}
              onClick={() => add.mutate()}>
              {add.isPending ? t('common.saving') : t('dict.addLines', { n: lineCount, amount: money(total) })}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}
