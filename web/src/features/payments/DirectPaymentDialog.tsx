import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { supabase } from '../../lib/supabase'
import { PAYMENT_METHODS, type PaymentMethod } from './api'
import { methodKey } from './labels'

type Props = { patientId: string; planId: string; planTitle: string; remaining: number; onClose: () => void }

/** Payment on a plan without installments (pay per session). */
export function DirectPaymentDialog({ patientId, planId, planTitle, remaining, onClose }: Props) {
  const { t, money } = useI18n()
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const value = Number(amount)
  const valid = Number.isFinite(value) && value > 0 && value <= remaining

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('record_direct_payment', {
        p_patient_id: patientId,
        p_amount: value,
        p_method: method,
        p_treatment_plan_id: planId,
        p_note: note.trim() || undefined,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', planId] })
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] })
    },
  })

  if (save.isSuccess) {
    return (
      <Modal title={t('pay.done')} onClose={onClose}>
        <p className="done-line">{t('pay.doneDetail', { amount: money(value), plan: planTitle })}</p>
        <div className="dialog-actions">
          <Link className="btn btn-primary" to={`/receipts/${save.data}`} target="_blank" rel="noreferrer">{t('pay.printReceipt')}</Link>
          <button className="btn" onClick={onClose}>{t('common.close')}</button>
        </div>
      </Modal>
    )
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (valid && !save.isPending) save.mutate()
  }

  return (
    <Modal title={t('pay.title')} onClose={onClose}>
      <form onSubmit={onSubmit} className="dialog-form">
        <p className="muted">{planTitle} — {t('pay.outstanding', { amount: money(remaining) })}</p>
        <div className="field-row">
          <label className="field">
            <span>{t('pay.amount')}</span>
            <input type="number" inputMode="decimal" min="0.01" step="0.01" max={remaining} required dir="ltr"
              value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== '' && !valid} autoFocus />
          </label>
          <label className="field">
            <span>{t('pay.method')}</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(methodKey(m))}</option>)}
            </select>
          </label>
        </div>
        {amount !== '' && value > remaining && (
          <p className="form-error" role="alert">{t('pay.tooMuch', { amount: money(remaining) })}</p>
        )}
        <label className="field">
          <span>{t('pay.note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
        {save.isError && <ErrorNote error={save.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={!valid || save.isPending}>
            {save.isPending ? t('common.saving') : t('pay.submit', { amount: valid ? money(value) : '' })}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}
