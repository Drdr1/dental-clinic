import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { ToothChart } from '../../components/ToothChart'
import { ErrorNote } from '../../components/ErrorNote'
import { addItems, type Procedure } from './api'

type Props = { planId: string; procedures: Procedure[]; markedTeeth: Set<number>; initialTeeth?: number[] }

/** Pick a procedure, tap the teeth it applies to (or none), confirm the price per tooth. */
export function AddItemsForm({ planId, procedures, markedTeeth, initialTeeth }: Props) {
  const { clinicId } = useMember()
  const { t, money } = useI18n()
  const queryClient = useQueryClient()
  const [procedureId, setProcedureId] = useState('')
  const [price, setPrice] = useState('')
  const [teeth, setTeeth] = useState<Set<number>>(() => new Set(initialTeeth ?? []))
  const [note, setNote] = useState('')
  // Opened from a tooth in the patient file: bring the form into view.
  const formRef = useRef<HTMLFormElement>(null)
  const cameWithTooth = (initialTeeth?.length ?? 0) > 0
  useEffect(() => {
    if (cameWithTooth) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [cameWithTooth])

  const priceValue = Number(price)
  const lineCount = Math.max(teeth.size, 1)
  const valid = !!procedureId && Number.isFinite(priceValue) && priceValue >= 0 && price !== ''

  const add = useMutation({
    mutationFn: () =>
      addItems(
        clinicId,
        planId,
        (teeth.size ? [...teeth].sort((a, b) => a - b) : [null]).map((tooth) => ({
          procedureId,
          tooth,
          price: priceValue,
          description: note.trim() || null,
        })),
      ),
    onSuccess: () => {
      setTeeth(new Set())
      setNote('')
      queryClient.invalidateQueries({ queryKey: ['plan', planId] })
    },
  })

  function chooseProcedure(id: string) {
    setProcedureId(id)
    const p = procedures.find((x) => x.id === id)
    if (p) setPrice(String(p.default_price))
  }

  function toggle(tooth: number) {
    setTeeth((prev) => {
      const next = new Set(prev)
      if (next.has(tooth)) next.delete(tooth)
      else next.add(tooth)
      return next
    })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (valid && !add.isPending) add.mutate()
  }

  return (
    <form className="add-items" onSubmit={onSubmit} ref={formRef}>
      <h3>{t('plan.addTitle')}</h3>
      <div className="field-row">
        <label className="field">
          <span>{t('plan.procedure')}</span>
          <select value={procedureId} onChange={(e) => chooseProcedure(e.target.value)} required>
            <option value="" disabled>{t('plan.chooseProcedure')}</option>
            {procedures.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t('plan.pricePerTooth')}</span>
          <input type="number" min="0" step="0.01" dir="ltr" required value={price}
            onChange={(e) => setPrice(e.target.value)} />
        </label>
      </div>

      <div className="field">
        <span>{t('plan.teeth')}</span>
        <ToothChart selected={teeth} onToggle={toggle} marked={markedTeeth} />
        <small className="hint">{t('plan.teethHint')}</small>
      </div>

      <label className="field">
        <span>{t('plan.itemNote')}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder={t('plan.itemNoteHint')} />
      </label>

      {add.isError && <ErrorNote error={add.error} />}

      <div className="dialog-actions">
        <button type="submit" className="btn btn-primary" disabled={!valid || add.isPending}>
          {add.isPending
            ? t('common.saving')
            : t('plan.addLines', { n: lineCount, amount: valid ? money(priceValue) : '' })}
        </button>
      </div>
    </form>
  )
}
