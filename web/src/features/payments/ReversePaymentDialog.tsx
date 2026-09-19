import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { reversePayment, type Payment } from './api'

export function ReversePaymentDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const { t, money } = useI18n()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')

  const reverse = useMutation({
    mutationFn: () => reversePayment(payment.id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger', payment.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['patient', payment.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['patients'] })
      onClose()
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (reason.trim() && !reverse.isPending) reverse.mutate()
  }

  return (
    <Modal title={t('reverse.title', { n: payment.receipt_no })} onClose={onClose}>
      <form onSubmit={onSubmit} className="dialog-form">
        <p>{t('reverse.explain', { amount: money(payment.amount) })}</p>
        <label className="field">
          <span>{t('reverse.reason')}</span>
          <input required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
            placeholder={t('reverse.reasonHint')} />
        </label>
        {reverse.isError && <ErrorNote error={reverse.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-danger" disabled={!reason.trim() || reverse.isPending}>
            {reverse.isPending ? t('common.saving') : t('reverse.submit')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}
