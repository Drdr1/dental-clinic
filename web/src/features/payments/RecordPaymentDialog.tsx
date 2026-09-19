import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { PAYMENT_METHODS, recordPayment, type InstallmentRow, type PaymentMethod } from './api'
import { previewAllocation, suggestedAmount } from './allocate'
import { methodKey } from './labels'

type Props = {
  planId: string
  planTitle: string
  patientId: string
  outstanding: number
  schedule: InstallmentRow[]
  onClose: () => void
}

export function RecordPaymentDialog({ planId, planTitle, patientId, outstanding, schedule, onClose }: Props) {
  const { t, money } = useI18n()
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState(() => String(suggestedAmount(schedule) || ''))
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')

  const value = Number(amount)
  const valid = Number.isFinite(value) && value > 0 && value <= outstanding
  const preview = valid ? previewAllocation(schedule, value) : null

  const save = useMutation({
    mutationFn: () => recordPayment({ planId, amount: value, method, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger', patientId] })
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] })
      queryClient.invalidateQueries({ queryKey: ['patients'] })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (valid && !save.isPending) save.mutate()
  }

  if (save.isSuccess) {
    return (
      <Modal title={t('pay.done')} onClose={onClose}>
        <p className="done-line">{t('pay.doneDetail', { amount: money(value), plan: planTitle })}</p>
        <div className="dialog-actions">
          <Link className="btn btn-primary" to={`/receipts/${save.data}`} target="_blank" rel="noreferrer">
            {t('pay.printReceipt')}
          </Link>
          <button className="btn" onClick={onClose}>{t('common.close')}</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={t('pay.title')} onClose={onClose}>
      <form onSubmit={onSubmit} className="dialog-form">
        <p className="muted">{planTitle} — {t('pay.outstanding', { amount: money(outstanding) })}</p>

        <div className="field-row">
          <label className="field">
            <span>{t('pay.amount')}</span>
            <input type="number" inputMode="decimal" min="0.01" step="0.01" max={outstanding} required
              dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== '' && !valid} />
          </label>
          <label className="field">
            <span>{t('pay.method')}</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t(methodKey(m))}</option>)}
            </select>
          </label>
        </div>

        {amount !== '' && value > outstanding && (
          <p className="form-error" role="alert">{t('pay.tooMuch', { amount: money(outstanding) })}</p>
        )}

        {preview && preview.lines.length > 0 && (
          <div className="allocation">
            <span className="allocation-title">{t('pay.covers')}</span>
            <ul>
              {preview.lines.map((l) => (
                <li key={l.seq}>
                  <span>{l.isDownPayment ? t('inst.downPayment') : t('inst.number', { n: l.seq })}</span>
                  <span>
                    {l.take >= l.remaining
                      ? t('pay.full', { amount: money(l.take) })
                      : t('pay.partial', { amount: money(l.take), of: money(l.remaining) })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
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
