import { useState } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { closeOrBack } from '../../lib/closeTab'
import { ErrorNote } from '../../components/ErrorNote'
import { ToothMark } from '../../components/ToothMark'
import { useClinicLogo } from '../../lib/useClinicLogo'
import { useMember } from '../auth/AuthProvider'
import { getAgreements, reissueAgreement } from './api'

/** Printable installment agreement. It is printed and signed on paper. */
export function AgreementPage() {
  const { planId = '' } = useParams()
  const { t, money, date } = useI18n()
  const { clinicId, role } = useMember()
  const logo = useClinicLogo(clinicId)
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['agreements', planId], queryFn: () => getAgreements(planId) })
  const [version, setVersion] = useState<number | null>(null)

  // An old contract is never edited: it is reissued as a new version on the
  // current clauses, and the signed one stays in the record untouched.
  const reissue = useMutation({
    mutationFn: () => reissueAgreement(planId),
    onSuccess: () => { setVersion(null); qc.invalidateQueries({ queryKey: ['agreements', planId] }) },
  })

  if (q.isPending) return <p className="splash">{t('common.loading')}</p>
  if (q.isError) return <div className="receipt-page"><ErrorNote error={q.error} /></div>
  if (!q.data.length) return <p className="splash">{t('agr.none')}</p>

  const latest = q.data[0]
  const versions = q.data.filter((x) => x.signed_at || x.version === q.data[0].version)
  const a = q.data.find((x) => x.version === (version ?? latest.version)) ?? latest
  const T = a.terms
  const isLatest = a.version === latest.version
  const subtotal = T.treatment.items.reduce((s, i) => s + i.price, 0)
  // Agreements signed before the fuller clause set have no version on them.
  const v2 = (T.clauses_version ?? 1) >= 2

  // The instalments proper: the down payment is not one of them.
  const instalments = T.schedule.filter((x) => !x.down_payment)
  // Measured from the first due date to the last, so it holds whatever the
  // cadence turns out to be.
  const termMonths = instalments.length < 2 ? instalments.length : (() => {
    const a1 = new Date(instalments[0].due_date), b1 = new Date(instalments[instalments.length - 1].due_date)
    return (b1.getFullYear() - a1.getFullYear()) * 12 + (b1.getMonth() - a1.getMonth()) + 1
  })()

  // Both layouts print the same two tables, so they are built once.
  const treatmentTable = (
    <>
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
    </>
  )

  const scheduleTable = (
    <>
      <table className="table table-compact doc-table">
        <tbody>
          {T.schedule.map((x) => (
            <tr key={x.seq}>
              <td>{x.down_payment ? t('inst.downPayment') : t('inst.number', { n: x.seq })}</td>
              <td>{date(x.due_date)}</td>
              <td className="num">{money(x.amount)}</td>
              <td className="muted">{x.paid >= x.amount ? t('inst.paid') : x.paid > 0 ? t('agr.paidPart', { amount: money(x.paid) }) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {T.paid_to_date > 0 && <p className="muted small">{t('agr.paidToDate', { amount: money(T.paid_to_date) })}</p>}
    </>
  )

  return (
    <div className="receipt-page">
      <article className="agreement">
        <header className="receipt-head">{logo.data ? <img src={logo.data} alt="" className="receipt-logo" /> : <ToothMark className="receipt-mark" />}<strong>{T.clinic}</strong></header>
        <h1>{v2 ? t('agr.titleFormal') : t('agr.title')}</h1>
        <p className="muted center">{t('agr.version', { n: a.version, date: date(T.generated_at) })}{a.version > 1 && ` — ${T.reason}`}</p>

        {/* From clause set 2 the contract follows the clinic's own paper
            contract: the same seven numbered sections, in the same order and
            the same formal wording. Anything issued before that keeps the
            layout it was issued on — what was handed to a patient should
            still look like what they were handed. */}
        {v2 ? (
          <>
            <p>{t('agr.partyClinic', {
              clinic: T.clinic,
              rep: T.represented_by ? t('agr.repBy', { name: T.represented_by }) : '',
            })}</p>
            <p>{t('agr.partyPatientFormal', {
              patient: T.patient.name,
              phone: T.patient.phone,
              id: T.patient.national_id ? t('agr.patientId', { id: T.patient.national_id }) : t('agr.idBlank'),
              address: T.patient.address ? t('agr.patientAddress', { address: T.patient.address }) : t('agr.addressBlank'),
            })}</p>
            <p>{t('agr.agreed')}</p>

            <h2>{t('agr.s1')}</h2>
            <p>{t('agr.s1body')}</p>
            {treatmentTable}

            <h2>{t('agr.s2')}</h2>
            <p>{t('agr.s2total', { amount: money(T.net_total) })}</p>
            <p>{t('agr.s2down', { amount: money(T.down_payment) })}</p>
            <p>{t('agr.s2rest', { amount: money(T.net_total - T.down_payment) })}</p>

            <h2>{t('agr.s3')}</h2>
            <p>{t('agr.s3body', { months: termMonths, n: instalments.length })}</p>
            {scheduleTable}
            <ul className="clauses">
              <li>{t('agr.f.payEach')}</li>
              {T.rules.installment_price_equals_cash && <li>{t('agr.f.sameAsCash')}</li>}
              <li>{t('agr.f.grace', { n: T.rules.grace_days })}</li>
              {!T.rules.late_fees && <li>{t('agr.f.noFees')}</li>}
              <li>{t('agr.f.changes')}</li>
            </ul>

            <h2>{t('agr.s4')}</h2>
            <ul className="clauses">
              <li>{t('agr.f.onTime')}</li>
              <li>{t('agr.f.suspend', { n: T.rules.suspend_after_days ?? 7 })}</li>
              <li>{t('agr.f.lock', { n: T.rules.session_lock_after_overdue })}</li>
              <li>{t('agr.f.legal')}</li>
            </ul>

            <h2>{t('agr.s5')}</h2>
            <p>{t('agr.f.proof')}</p>

            <h2>{t('agr.s6')}</h2>
            <p>{t('agr.f.understood')}</p>

            {T.legal_venue && <>
              <h2>{t('agr.s7')}</h2>
              <p>{t('agr.f.venue', { venue: T.legal_venue })}</p>
            </>}
          </>
        ) : (
          <>
            <p>{t('agr.parties', { clinic: T.clinic, patient: T.patient.name, phone: T.patient.phone })}</p>
            <h2>{t('agr.treatment', { title: T.treatment.title })}</h2>
            {treatmentTable}
            <h2>{t('agr.schedule')}</h2>
            {scheduleTable}
            <h2>{t('agr.terms')}</h2>
            <ol className="clauses">
              {T.rules.installment_price_equals_cash && <li>{t('agr.c.sameAsCash')}</li>}
              <li>{t('agr.c.dueDates')}</li>
              <li>{t('agr.c.grace', { n: T.rules.grace_days })}</li>
              {!T.rules.late_fees && <li>{t('agr.c.noFees')}</li>}
              <li>{t('agr.c.lock', { n: T.rules.session_lock_after_overdue })}</li>
              <li>{t('agr.c.changes')}</li>
            </ol>
          </>
        )}
        {/* Closing lines and signatures print on one page: a signature must
            never land on a sheet with nothing above it. */}
        <div className="doc-keep">
        {v2 && <p className="small">{t('agr.copies')}</p>}

        {/* Owner and doctors only: reception does not restate legal terms. */}
        {!v2 && isLatest && role !== 'receptionist' && (
          <div className="panel no-print">
            <p>{a.signed_at ? t('agr.oldTermsSigned') : t('agr.oldTerms')}</p>
            {reissue.isError && <ErrorNote error={reissue.error} />}
            <button className="btn" disabled={reissue.isPending} onClick={() => reissue.mutate()}>
              {reissue.isPending ? t('common.saving') : t('agr.reissue')}
            </button>
          </div>
        )}

        <section className="doc-signatures">
          <div>
            <span className="muted">{t('agr.patientSignature')}</span>
            {/* The clinic signs on paper, so the contract carries a line to sign
                on rather than a pad nobody uses. A signature captured before
                this still shows, because it is part of that record. */}
            {a.signed_at ? (
              <>
                <img src={a.signature_data ?? ''} alt={t('pform.signature')} className="sig-image" />
                <p className="small">{a.signed_by_name} — {date(a.signed_at)}</p>
              </>
            ) : (
              <>
                {!isLatest && <p className="muted small no-print">{t('agr.superseded')}</p>}
                <div className="sig-line" />
              </>
            )}
          </div>
          <div>
            <span className="muted">{t('agr.clinicSignature')}</span>
            {v2 && T.represented_by && <p className="small">{T.represented_by}</p>}
            <div className="sig-line" />
          </div>
        </section>
        {v2 && <p className="muted small print-only">{t('agr.signedOn')}</p>}
        </div>
      </article>

      <div className="receipt-actions no-print">
        {/* Superseded drafts nobody signed are noise — reception only needs the
            contract in force. A signed older version is a different matter:
            that one is a real agreement and stays reachable. */}
        {versions.length > 1 && (
          <select value={a.version} onChange={(e) => setVersion(Number(e.target.value))} className="date-jump">
            {versions.map((x) => <option key={x.version} value={x.version}>{t('agr.versionShort', { n: x.version })}</option>)}
          </select>
        )}
        <button className="btn btn-primary" onClick={() => window.print()}>{t('receipt.print')}</button>
        <button className="btn" onClick={closeOrBack}>{t('common.close')}</button>
      </div>
    </div>
  )
}
