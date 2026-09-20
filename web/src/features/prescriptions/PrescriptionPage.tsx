import { useEffect, useRef } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { ToothMark } from '../../components/ToothMark'
import { ageFrom } from '../../lib/phone'
import { getPrescription } from './api'

/** A5 printable prescription. Drug names stay in Latin script, instructions can be Arabic. */
export function PrescriptionPage() {
  const { id = '' } = useParams()
  const { t, date } = useI18n()
  const q = useQuery({ queryKey: ['prescription', id], queryFn: () => getPrescription(id) })
  const printed = useRef(false)
  useEffect(() => {
    if (q.data && !printed.current) { printed.current = true; setTimeout(() => window.print(), 300) }
  }, [q.data])

  if (q.isPending) return <p className="splash">{t('common.loading')}</p>
  if (q.isError) return <div className="receipt-page"><ErrorNote error={q.error} /></div>
  if (!q.data) return <p className="splash">{t('rx.notFound')}</p>
  const { rx, items, patient, clinicName, doctor } = q.data
  const age = ageFrom(patient?.date_of_birth ?? null)

  return (
    <div className="receipt-page">
      <article className="rx-sheet">
        <header className="rx-head">
          <div className="rx-brand"><ToothMark className="receipt-mark" /><strong>{clinicName}</strong></div>
          <div className="rx-doctor">{doctor}</div>
        </header>
        <div className="rx-patient">
          <span>{t('rx.patient')}: <strong>{patient?.full_name}</strong></span>
          {age !== null && <span>{t('patient.age', { n: age })}</span>}
          <span>{date(rx.prescribed_at)}</span>
        </div>
        <div className="rx-symbol" dir="ltr">℞</div>
        <ol className="rx-print-items" dir="ltr">
          {items.map((i) => (
            <li key={i.id}>
              <strong>{i.drug_name}</strong>
              <div className="rx-print-sub">{[i.dose, i.frequency, i.duration].filter(Boolean).join(' — ')}</div>
              {i.notes && <div className="rx-print-note rx-mixed">{i.notes}</div>}
            </li>
          ))}
        </ol>
        {rx.notes && <p className="rx-print-note">{rx.notes}</p>}
        <footer className="rx-foot"><span>{t('rx.signature')}</span><span className="signature" /></footer>
      </article>
      <div className="receipt-actions no-print">
        <button className="btn btn-primary" onClick={() => window.print()}>{t('receipt.print')}</button>
        <button className="btn" onClick={() => window.close()}>{t('common.close')}</button>
      </div>
    </div>
  )
}
