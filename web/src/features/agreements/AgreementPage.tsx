import { useState } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { SignaturePad } from '../../components/SignaturePad'
import { ToothMark } from '../../components/ToothMark'
import { getAgreements, signAgreement } from './api'

/** Printable installment agreement, signed by the patient on the reception tablet. */
export function AgreementPage() {
  const { planId = '' } = useParams()
  const { t, money, date } = useI18n()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['agreements', planId], queryFn: () => getAgreements(planId) })
  const [version, setVersion] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)

  const sign = useMutation({
    mutationFn: (id: string) => signAgreement(id, name, signature!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agreements', planId] }),
  })

  if (q.isPending) return <p className="splash">{t('common.loading')}</p>
  if (q.isError) return <div className="receipt-page"><ErrorNote error={q.error} /></div>
  if (!q.data.length) return <p className="splash">{t('agr.none')}</p>

  const latest = q.data[0]
  const a = q.data.find((x) => x.version === (version ?? latest.version)) ?? latest
  const T = a.terms
  const isLatest = a.version === latest.version
  const subtotal = T.treatment.items.reduce((s, i) => s + i.price, 0)

  return (
    <div className="receipt-page">
      <article className="agreement">
        <header className="receipt-head"><ToothMark className="receipt-mark" /><strong>{T.clinic}</strong></header>
        <h1>{t('agr.title')}</h1>
        <p className="muted center">{t('agr.version', { n: a.version, date: date(T.generated_at) })}{a.version > 1 && ` — ${T.reason}`}</p>

        <p>{t('agr.parties', { clinic: T.clinic, patient: T.patient.name, phone: T.patient.phone })}</p>

        <h2>{t('agr.treatment', { title: T.treatment.title })}</h2>
        <table className="table table-compact doc-table">
          <tbody>
            {T.treatment.items.map((i, n) => (
              <tr key={n}><td>{i.description}{i.tooth ? ` — ${t('plan.tooth', { n: i.tooth })}` : ''}</td><td className="num">{money(i.price)}</td></tr>
            ))}
            {T.treatment.discount > 0 && <tr><td>{t('plan.discount')}</td><td className="num">−{money(T.treatment.discount)}</td></tr>}
            <tr className="doc-total"><td>{t('plan.net')}</td><td className="num">{money(T.net_total)}</td></tr>
          </tbody>
        </table>
        {T.treatment.discount > 0 && <p className="muted small">{t('agr.subtotal', { amount: money(subtotal) })}</p>}

        <h2>{t('agr.schedule')}</h2>
        <table className="table table-compact doc-table">
          <tbody>
            {T.schedule.map((s) => (
              <tr key={s.seq}>
                <td>{s.down_payment ? t('inst.downPayment') : t('inst.number', { n: s.seq })}</td>
                <td>{date(s.due_date)}</td>
                <td className="num">{money(s.amount)}</td>
                <td className="muted">{s.paid >= s.amount ? t('inst.paid') : s.paid > 0 ? t('agr.paidPart', { amount: money(s.paid) }) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {T.paid_to_date > 0 && <p className="muted small">{t('agr.paidToDate', { amount: money(T.paid_to_date) })}</p>}

        {/* Terms and signatures print together, so the signature page is never separated from what was agreed. */}
        <div className="doc-keep">
        <h2>{t('agr.terms')}</h2>
        <ol className="clauses">
          {T.rules.installment_price_equals_cash && <li>{t('agr.c.sameAsCash')}</li>}
          <li>{t('agr.c.dueDates')}</li>
          <li>{t('agr.c.grace', { n: T.rules.grace_days })}</li>
          {!T.rules.late_fees && <li>{t('agr.c.noFees')}</li>}
          <li>{t('agr.c.lock', { n: T.rules.session_lock_after_overdue })}</li>
          <li>{t('agr.c.changes')}</li>
        </ol>

        <section className="doc-signatures">
          <div>
            <span className="muted">{t('agr.patientSignature')}</span>
            {a.signed_at ? (
              <>
                <img src={a.signature_data ?? ''} alt={t('pform.signature')} className="sig-image" />
                <p className="small">{a.signed_by_name} — {date(a.signed_at)}</p>
              </>
            ) : isLatest ? (
              <div className="no-print dialog-form">
                <input placeholder={t('pform.fullName')} value={name} onChange={(e) => setName(e.target.value)} />
                <SignaturePad onChange={setSignature} />
                {sign.isError && <ErrorNote error={sign.error} />}
                <button className="btn btn-primary" disabled={name.trim().length < 3 || !signature || sign.isPending}
                  onClick={() => sign.mutate(a.id)}>{t('agr.sign')}</button>
              </div>
            ) : <p className="muted small">{t('agr.superseded')}</p>}
            {!a.signed_at && <div className="print-only sig-line" />}
          </div>
          <div>
            <span className="muted">{t('agr.clinicSignature')}</span>
            <div className="sig-line" />
          </div>
        </section>
        </div>
      </article>

      <div className="receipt-actions no-print">
        {q.data.length > 1 && (
          <select value={a.version} onChange={(e) => setVersion(Number(e.target.value))} className="date-jump">
            {q.data.map((x) => <option key={x.version} value={x.version}>{t('agr.versionShort', { n: x.version })}</option>)}
          </select>
        )}
        <button className="btn btn-primary" onClick={() => window.print()}>{t('receipt.print')}</button>
        <button className="btn" onClick={() => window.close()}>{t('common.close')}</button>
      </div>
    </div>
  )
}
