import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMember } from '../features/auth/AuthProvider'
import { searchPatients } from '../features/patients/api'
import { useDebounced } from '../lib/useDebounced'
import { useI18n } from '../i18n'

export type PickedPatient = { id: string; full_name: string; phone: string; medical_alerts: string | null }

/** Type a name or phone, pick from the matches. */
export function PatientPicker({ value, onChange }: { value: PickedPatient | null; onChange: (p: PickedPatient | null) => void }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const term = useDebounced(q)
  const results = useQuery({
    queryKey: ['patients', clinicId, term],
    queryFn: () => searchPatients(clinicId, term),
    enabled: !value && term.trim().length >= 2,
  })

  if (value) {
    return (
      <div className="picked">
        <span><strong>{value.full_name}</strong> <span className="muted" dir="ltr">{value.phone}</span></span>
        <button type="button" className="link-btn" onClick={() => onChange(null)}>{t('appt.changePatient')}</button>
      </div>
    )
  }

  return (
    <div className="picker">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('patients.search')}
        aria-label={t('appt.patient')} autoFocus />
      {results.data && results.data.length > 0 && (
        <ul className="picker-list" role="listbox">
          {results.data.slice(0, 8).map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onChange(p)}>
                <span>{p.full_name}</span>
                <span className="muted" dir="ltr">{p.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results.data && results.data.length === 0 && term.trim().length >= 2 && (
        <p className="hint">{t('patients.noResults', { q: term.trim() })}</p>
      )}
    </div>
  )
}
