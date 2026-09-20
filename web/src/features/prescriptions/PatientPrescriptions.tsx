import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { getPatientPrescriptions } from './api'
import { PrescriptionDialog } from './PrescriptionDialog'

type Patient = { id: string; full_name: string; medical_alerts: string | null; allergy_groups: string[] }

export function PatientPrescriptions({ patient }: { patient: Patient }) {
  const { isDoctor } = useAuth()
  const { t, date } = useI18n()
  const [writing, setWriting] = useState(false)
  const q = useQuery({ queryKey: ['prescriptions', patient.id], queryFn: () => getPatientPrescriptions(patient.id) })

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('rx.title')}</h2>
        {isDoctor && <button className="btn" onClick={() => setWriting(true)}>{t('rx.newShort')}</button>}
      </div>
      {q.data?.length === 0 && <p className="muted">{t('rx.none')}</p>}
      <ul className="plan-list">
        {q.data?.map((p) => (
          <li key={p.id}>
            <div className="plan-line">
              <span>{date(p.prescribed_at)}</span>
              <Link to={`/prescriptions/${p.id}`} target="_blank" rel="noreferrer">{t('payments.print')}</Link>
            </div>
            <p className="plan-sub muted" dir="ltr">{p.drugs.join(' · ')}</p>
            {p.allergy_override_reason && <p className="plan-sub warn-text">{t('rx.overridden', { reason: p.allergy_override_reason })}</p>}
          </li>
        ))}
      </ul>
      {writing && <PrescriptionDialog patient={patient} onClose={() => setWriting(false)} />}
    </section>
  )
}
