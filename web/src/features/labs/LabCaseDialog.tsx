import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { PatientPicker, type PickedPatient } from '../../components/PatientPicker'
import { todayLocal, toIsoDate } from '../../lib/dates'
import { getClinicDoctors } from '../appointments/api'
import { addLab, createCase, editCase, getLabItems, getLabs, getOpenItems, type LabCase } from './api'

const plusDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return toIsoDate(new Date(y, m - 1, d + n))
}

export function LabCaseDialog(
  { onClose, patient: fixedPatient, editing }:
  { onClose: () => void; patient?: PickedPatient; editing?: LabCase },
) {
  const { clinicId, userId, role } = useMember()
  const { t, money } = useI18n()
  const queryClient = useQueryClient()
  const labs = useQuery({ queryKey: ['labs', clinicId], queryFn: () => getLabs(clinicId) })
  // Whose case this is: the lab fee comes off that doctor's commission.
  const doctors = useQuery({ queryKey: ['clinic-doctors', clinicId], queryFn: () => getClinicDoctors(clinicId) })

  const e = editing
  const [patient, setPatient] = useState<PickedPatient | null>(
    fixedPatient ?? (e ? { id: e.patient_id!, full_name: e.full_name ?? '', phone: '', medical_alerts: null } : null))
  const [itemId, setItemId] = useState(e?.plan_item_id ?? '')
  const [labId, setLabId] = useState(e?.lab_id ?? '')
  const [description, setDescription] = useState(e?.description ?? '')
  const [shade, setShade] = useState(e?.shade ?? '')
  const [fee, setFee] = useState(e?.item_id ? '' : (e?.lab_fee != null ? String(e.lab_fee) : ''))
  const [sentOn, setSentOn] = useState(e?.sent_on ?? todayLocal())
  const [expectedOn, setExpectedOn] = useState(e?.expected_on ?? plusDays(todayLocal(), 7))
  const [notes, setNotes] = useState(e?.notes ?? '')
  const [doctorId, setDoctorId] = useState(e?.doctor_id ?? (role === 'doctor' ? userId : ''))
  const [newLab, setNewLab] = useState<{ name: string; phone: string } | null>(null)
  const [kindId, setKindId] = useState(e?.item_id ?? '')
  const [units, setUnits] = useState(e?.units != null ? String(e.units) : '1')
  const [needsTryin, setNeedsTryin] = useState(e?.needs_tryin ?? true)
  // The price list, so a case is costed the day it is opened.
  const kinds = useQuery({ queryKey: ['lab-items', clinicId], queryFn: () => getLabItems(clinicId) })
  const kind = kinds.data?.find((i) => i.id === kindId)
  const expected = kind && Number(units) > 0 ? Math.round(kind.unit_price * Number(units) * 100) / 100 : null

  const items = useQuery({
    queryKey: ['open-items', patient?.id],
    queryFn: () => getOpenItems(patient!.id),
    enabled: !!patient,
  })

  const effectiveLab = labId || labs.data?.[0]?.id || ''
  // Nothing is saved half-filled: a case with no doctor takes its fee off
  // nobody, and a case with no price cannot be checked against the invoice.
  const hasDoctors = (doctors.data?.length ?? 0) > 0
  const priced = kindId ? (expected ?? 0) > 0 : Number(fee) > 0
  const valid = !!patient && (!!effectiveLab || !!newLab?.name.trim()) && description.trim().length > 0 &&
    !!sentOn && !!expectedOn && expectedOn >= sentOn &&
    (!hasDoctors || !!doctorId) && priced

  const save = useMutation({
    mutationFn: async () => {
      let lab = effectiveLab
      if (newLab?.name.trim()) lab = (await addLab(clinicId, newLab.name, newLab.phone)).id
      if (e) {
        return editCase(e.id!, {
          labId: lab, doctorId, description, shade,
          labFee: kindId ? (expected ?? null) : (fee === '' ? null : Number(fee)),
          itemId: kindId || null,
          // Re-price only when the kind changed; old work keeps its old cost.
          unitPrice: kindId && kindId === e.item_id ? (e.unit_price ?? null) : null,
          units: Number(units) || 1, needsTryin, sentOn, expectedOn, notes,
        })
      }
      await createCase({
        clinicId, patientId: patient!.id, labId: lab, planItemId: itemId || null, description, shade,
        labFee: fee === '' ? null : Number(fee), sentOn, expectedOn, notes,
        doctorId: doctorId || null,
        itemId: kindId || null, units: Number(units) || 1, needsTryin,
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

  function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (valid && !save.isPending) save.mutate()
  }

  return (
    <Modal title={e ? t('lab.edit') : t('lab.new')} onClose={onClose}>
      <form className="dialog-form" onSubmit={onSubmit}>
        <div className="field">
          <span>{t('appt.patient')}</span>
          {fixedPatient || e
            ? <div className="picked"><strong>{(fixedPatient ?? patient)?.full_name}</strong></div>
            : <PatientPicker value={patient} onChange={(p) => { setPatient(p); setItemId('') }} />}
        </div>

        {patient && (items.data?.length ?? 0) > 0 && (
          <label className="field">
            <span>{t('lab.forItem')}</span>
            <select value={itemId} onChange={(ev) => pickItem(ev.target.value)}>
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
          <input required value={description} onChange={(ev) => setDescription(ev.target.value)} maxLength={120}
            placeholder={t('lab.descriptionHint')} />
        </label>

        {newLab ? (
          <div className="field-row">
            <label className="field">
              <span>{t('lab.newLabName')}</span>
              <input required value={newLab.name} onChange={(ev) => setNewLab({ ...newLab, name: ev.target.value })} autoFocus />
            </label>
            <label className="field">
              <span>{t('lab.newLabPhone')}</span>
              <input dir="ltr" inputMode="tel" value={newLab.phone} onChange={(ev) => setNewLab({ ...newLab, phone: ev.target.value })} />
            </label>
          </div>
        ) : (
          <label className="field">
            <span>{t('lab.lab')}</span>
            <div className="inline-controls">
              <select value={effectiveLab} onChange={(ev) => setLabId(ev.target.value)} disabled={!labs.data?.length}>
                {labs.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <button type="button" className="btn btn-small" onClick={() => setNewLab({ name: '', phone: '' })}>
                {t('lab.addLab')}
              </button>
            </div>
          </label>
        )}

        <label className="field">
          <span>{t('lab.doctor')}</span>
          <select required value={doctorId} onChange={(ev) => setDoctorId(ev.target.value)}>
            <option value="" disabled>{t('lab.pickDoctor')}</option>
            {doctors.data?.map((d) => <option key={d.user_id} value={d.user_id}>{d.display_name}</option>)}
          </select>
        </label>

        <div className="field-row">
          <label className="field">
            <span>{t('lab.sentOn')}</span>
            <input type="date" required value={sentOn} max={todayLocal()} onChange={(ev) => setSentOn(ev.target.value)} />
          </label>
          <label className="field">
            <span>{t('lab.expectedOn')}</span>
            <input type="date" required value={expectedOn} min={sentOn} onChange={(ev) => setExpectedOn(ev.target.value)} />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>{t('lab.itemType')}</span>
            <select value={kindId} onChange={(ev) => { setKindId(ev.target.value); setFee('') }}>
              <option value="">{t('lab.itemOther')}</option>
              {(kinds.data ?? []).filter((i) => i.active).map((i) => (
                <option key={i.id} value={i.id}>{i.name} — {money(i.unit_price)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('lab.units')}</span>
            <input type="number" min={1} step={1} dir="ltr" value={units}
              onChange={(ev) => setUnits(ev.target.value)} disabled={!kindId} />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>{t('lab.shade')}</span>
            <input value={shade} onChange={(ev) => setShade(ev.target.value)} maxLength={20} dir="ltr" placeholder="A2" />
          </label>
          <label className="field">
            <span>{t('lab.fee')}</span>
            <input type="number" min={0} step={1} dir="ltr" disabled={!!kindId}
              value={kindId ? (expected ?? '') : fee} onChange={(ev) => setFee(ev.target.value)} />
            {kindId && <small className="hint">{t('lab.feeFromList', { units, price: money(kind?.unit_price ?? 0) })}</small>}
          </label>
        </div>

        <label className="check">
          <input type="checkbox" checked={needsTryin} onChange={(ev) => setNeedsTryin(ev.target.checked)} />
          <span>{t('lab.needsTryin')}</span>
        </label>

        <label className="field">
          <span>{t('appt.notes')}</span>
          <input value={notes} onChange={(ev) => setNotes(ev.target.value)} maxLength={200} />
        </label>

        {save.isError && <ErrorNote error={save.error} />}
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" disabled={!valid || save.isPending}>
            {save.isPending ? t('common.saving') : e ? t('common.save') : t('lab.save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}
