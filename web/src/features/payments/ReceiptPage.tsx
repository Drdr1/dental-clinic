import { useEffect, useRef } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { closeOrBack } from '../../lib/closeTab'
import { ErrorNote } from '../../components/ErrorNote'
import { ToothMark } from '../../components/ToothMark'
import { getReceipt } from './api'
import { methodKey } from './labels'

export function ReceiptPage() {
  const { id = '' } = useParams()
  const { t, money, lang } = useI18n()
  const receipt = useQuery({ queryKey: ['receipt', id], queryFn: () => getReceipt(id), enabled: !!id })
  const printed = useRef(false)

  // Open the print dialog once, as soon as the receipt is on screen.
  useEffect(() => {
    if (receipt.data && !printed.current) {
      printed.current = true
      setTimeout(() => window.print(), 300)
    }
  }, [receipt.data])

  if (receipt.isPending) return <p className="splash">{t('common.loading')}</p>
  if (receipt.isError) return <div className="receipt-page"><ErrorNote error={receipt.error} /></div>
  if (!receipt.data) return <p className="splash">{t('receipt.notFound')}</p>

  const { payment, clinicName, patient, planTitle, outstanding, reversesReceiptNo, receivedBy } = receipt.data
  const isReversal = payment.amount < 0
  const when = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(payment.received_at))

  return (
    <div className="receipt-page">
      <article className="receipt">
        <header className="receipt-head">
          <ToothMark className="receipt-mark" />
          <strong>{clinicName}</strong>
        </header>

        <h1>
          {isReversal
            ? t('receipt.reversalTitle', { n: payment.receipt_no, of: reversesReceiptNo ?? '' })
            : t('receipt.title', { n: payment.receipt_no })}
        </h1>

        <dl className="receipt-lines">
          <div><dt>{t('receipt.date')}</dt><dd>{when}</dd></div>
          <div><dt>{isReversal ? t('receipt.refundedTo') : t('receipt.receivedFrom')}</dt><dd>{patient?.full_name}</dd></div>
          {planTitle && <div><dt>{t('receipt.for')}</dt><dd>{planTitle}</dd></div>}
          <div><dt>{t('receipt.method')}</dt><dd>{t(methodKey(payment.method))}</dd></div>
          {payment.note && <div><dt>{t('receipt.note')}</dt><dd>{payment.note}</dd></div>}
        </dl>

        <div className="receipt-amount">
          <span>{t('receipt.amount')}</span>
          <strong>{money(Math.abs(payment.amount))}</strong>
        </div>

        {outstanding !== null && (
          <p className="receipt-balance">{t('receipt.outstanding', { amount: money(outstanding) })}</p>
        )}

        <footer className="receipt-foot">
          <span>{t('receipt.receivedBy', { name: receivedBy ?? '' })}</span>
          <span className="signature">{t('receipt.signature')}</span>
        </footer>
      </article>

      <div className="receipt-actions no-print">
        <button className="btn btn-primary" onClick={() => window.print()}>{t('receipt.print')}</button>
        <button className="btn" onClick={closeOrBack}>{t('common.close')}</button>
      </div>
    </div>
  )
}
