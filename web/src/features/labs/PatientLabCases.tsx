import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../../i18n'
import type { PickedPatient } from '../../components/PatientPicker'
import { getPatientCases } from './api'
import { LabCaseDialog } from './LabCaseDialog'
import { LabCaseList } from './LabCaseList'

/** Open lab work for one patient, on the patient file. */
export function PatientLabCases({ patient }: { patient: PickedPatient }) {
  const { t } = useI18n()
  const [adding, setAdding] = useState(false)
  const q = useQuery({ queryKey: ['lab-cases', 'patient', patient.id], queryFn: () => getPatientCases(patient.id) })

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('lab.patientTitle')}</h2>
        <button className="btn" onClick={() => setAdding(true)}>{t('lab.send')}</button>
      </div>
      {q.data?.length === 0 && <p className="muted">{t('lab.patientEmpty')}</p>}
      {q.data && q.data.length > 0 && <LabCaseList cases={q.data} showPatient={false} />}
      {adding && <LabCaseDialog patient={patient} onClose={() => setAdding(false)} />}
    </section>
  )
}
