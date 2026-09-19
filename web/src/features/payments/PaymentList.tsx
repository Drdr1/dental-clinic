import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import type { Payment } from './api'
import { ReversePaymentDialog } from './ReversePaymentDialog'
import { methodKey } from './labels'

export function PaymentList({ payments, staffNames }: { payments: Payment[]; staffNames: Map<string, string> }) {
  const { t, money, date } = useI18n()
  const { isDoctor } = useAuth()
  const [reversing, setReversing] = useState<Payment | null>(null)
  const reversedIds = new Set(payments.map((p) => p.reverses_payment_id).filter(Boolean))

  return (
    <>
      <ul className="payment-list">
        {payments.map((p) => {
          const isReversal = p.amount < 0
          const wasReversed = reversedIds.has(p.id)
          return (
            <li key={p.id} className={isReversal || wasReversed ? 'is-void' : ''}>
              <div className="payment-main">
                <span className="payment-amount">{money(p.amount)}</span>
                <span>{t(methodKey(p.method))}</span>
                <span className="muted">{date(p.received_at)}</span>
              </div>
              <div className="payment-sub">
                <span className="muted">
                  {t('payments.receipt', { n: p.receipt_no })}
                  {p.received_by && staffNames.get(p.received_by) ? ` — ${staffNames.get(p.received_by)}` : ''}
                </span>
                {isReversal && <span className="badge badge-muted">{t('payments.reversal')}</span>}
                {wasReversed && <span className="badge badge-muted">{t('payments.reversed')}</span>}
                {p.note && <span className="muted">{p.note}</span>}
                <span className="payment-actions">
                  <Link to={`/receipts/${p.id}`} target="_blank" rel="noreferrer">{t('payments.print')}</Link>
                  {isDoctor && !isReversal && !wasReversed && (
                    <button className="link-btn danger-link" onClick={() => setReversing(p)}>{t('payments.reverse')}</button>
                  )}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      {reversing && <ReversePaymentDialog payment={reversing} onClose={() => setReversing(null)} />}
    </>
  )
}
