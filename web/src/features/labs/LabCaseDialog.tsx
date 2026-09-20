import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { PatientPicker, type PickedPatient } from '../../components/PatientPicker'
import { todayLocal, toIsoDate } from '../../lib/dates'
import { addLab, createCase, getLabs, getOpenItems } from './api'

const plusDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return toIsoDate(new Date(y, m - 1, d + n))
}

export function LabCaseDialog({ onClose, patient: fixedPatient }: { onClose: () => void; patient?: PickedPatient }) {
  const { clinicId } = useMember()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const labs = useQuery({ queryKey: ['labs', clinicId], queryFn: () => getLabs(clinicId) })

  const [patient, setPatient] = useState<PickedPatient | null>(fixedPatient ?? null)
  const [itemId, setItemId] = useState('')
  const [labId, setLabId] = useState('')
  const [description, setDescription] = useState('')
  const [shade, setShade] = useState('')
  const [fee, setFee] = useState('')
  const [sentOn, setSentOn] = useState(todayLocal())
  const [expectedOn, setExpectedOn] = useState(plusDays(todayLocal(), 7))
  const [notes, setNotes] = useState('')
  const [newLab, setNewLab] = useState<{ name: string; phone: string } | null>(null)

  const items = useQuery({
    queryKey: ['open-items', patient?.id],
    queryFn: () => getOpenItems(patient!.id),
    enabled: !!patient,
  })

  const effectiveLab = labId || labs.data?.[0]?.id || ''
  const valid = !!patient && (!!effectiveLab || !!newLab?.name.trim()) && description.trim().length > 0 &&
    !!sentOn && !!expectedOn && expectedOn >= sentOn

  const save = useMutation({
    mutationFn: async () => {
      let lab = effectiveLab
      if (newLab?.name.trim()) lab = (await addLab(clinicId, newLab.name, newLab.phone)).id
      await createCase({
        clinicId, patientId: patient!.id, labId: lab, planItemId: itemId || null, description, shade,
        labFee: fee === '' ? null : Number(fee), sentOn, expectedOn, notes,
      })
    },
    onSuccess: () => {
      for (const k of ['lab-cases', 'labs', 'today']) queryClient.invalidateQueries({ queryKey: [k] })
      onClose()
    },
  })

  function pickItem(id: string) {
    setItemId(id)
    const item = items.data?.find((i) => i.id === id)
    if (item && !description.trim()) {
      setDescription([item.label, item.tooth ? t('plan.tooth', { n: item.tooth }) : null].filter(Boolean).join(' — '))
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (valid && !save.isPending) save.mutate()
  }

  return (
    <Modal title={t('lab.new')} onClose={onClose}>
      <form className="dialog-form" onSubmit={onSubmit}>
        <div className="field">
          <span>{t('appt.patient')}</span>
          {fixedPatient
            ? <div className="picked"><strong>{fixedPatient.full_name}</strong></div>
            : <PatientPicker value={patient} onChange={(p) => { setPatient(p); setItemId('') }} />}
        </div>

        {patient && (items.data?.length ?? 0) > 0 && (
          <label className="field">
            <span>{t('lab.forItem')}</span>
            <select value={itemId} onChange={(e) => pickItem(e.target.value)}>
              <option value="">{t('lab.noItem')}</option>
              {items.data!.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.planTitle} — {i.label}{i.tooth ? ` (${i.tooth})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>{t('lab.description')}</span>
          <input required value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120}
            placeholder={t('lab.descriptionHint')} />
        </label>

        {newLab ? (
          <div className="field-row">
            <label className="field">
              <span>{t('lab.newLabName')}</span>
              <input required value={newLab.name} onChange={(e) => setNewLab({ ...newLab, name: e.target.value })} autoFocus />
            </label>
            <label className="field">
              <span>{t('lab.newLabPhone')}</span>
              <input dir="ltr" inputMode="tel" value={newLab.phone} onChange={(e) => setNewLab({ ...newLab, phone: e.target.value })} />
            </label>
          </div>
        ) : (
          <label className="field">
            <span>{t('lab.lab')}</span>
            <div className="inline-controls">
              <select value={effectiveLab} onChange={(e) => setLabId(e.target.value)} disabled={!labs.data?.length}>
                {labs.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <button type="button" className="btn btn-small" onClick={() => setNewLab({ name: '', phone: '' })}>
                {t('lab.addLab')}
              </button>
            </div>
          </label>
        )}

        <div className="field-row">
          <label className="field">
            <span>{t('lab.sentOn')}</span>
            <input type="date" required value={sentOn} max={todayLocal()} onChange={(e) => setSentOn(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('lab.expectedOn')}</span>
            <input type="date" required value={expectedOn} min={sentOn} onChange={(e) => setExpectedOn(e.target.value)} />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>{t('lab.shade')}</span>
            <input value={shade} onChange={(e) => setShade(e.target.value)} maxLength={20} dir="ltr" placeholder="A2" />
          </label>
          <label className="field">
            <span>{t('lab.fee')}</span>
            <input type="number" min={0} step={1} dir="ltr" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>{t('appt.notes')}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
        </label>

        {save.isError && <ErrorNote error={save.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={!valid || save.isPending}>
            {save.isPending ? t('common.saving') : t('lab.save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}
