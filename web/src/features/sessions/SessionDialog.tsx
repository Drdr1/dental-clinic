import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, useMember } from '../auth/AuthProvider'
import { useI18n } from '../../i18n'
import { Modal } from '../../components/Modal'
import { ErrorNote } from '../../components/ErrorNote'
import { errorKey } from '../../lib/errors'
import { getClinicDoctors, getPatientDoctor } from '../appointments/api'
import { recordSession } from './api'
import { supabase } from '../../lib/supabase'
import { DictateBox } from '../dictation/DictateBox'
import { draftSession } from '../dictation/api'
import { Icon } from '../../components/Icon'

export type OpenItem = { id: string; label: string }

type Props = {
  /** Open with the voice box already showing (the patient file's 'تسجيل بالصوت'). */
  dictate?: boolean
  patientId: string
  plan: { id: string; title: string; openItems: OpenItem[] } | null
  onClose: () => void
}

type PlanChoice = { id: string; title: string; openItems: OpenItem[] }

/** The patient's plans that still have work to do, for a visit recorded from the patient file. */
async function openPlans(patientId: string, toothLabel: (n: number) => string): Promise<PlanChoice[]> {
  const { data, error } = await supabase
    .from('treatment_plans')
    .select('id, title, status, accepted_at, treatment_plan_items(id, status, tooth_number, description, procedures(name))')
    .eq('patient_id', patientId)
    .in('status', ['active', 'presented'])
    .order('accepted_at', { ascending: false, nullsFirst: false })
  if (error) throw error
  type Row = { id: string; title: string; status: string; treatment_plan_items: { id: string; status: string; tooth_number: number | null; description: string | null; procedures: { name: string } | null }[] }
  return ((data ?? []) as unknown as Row[])
    // Plans under way first, then ones only proposed.
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))
    .map((p) => ({
      id: p.id,
      title: p.title,
      openItems: p.treatment_plan_items.filter((i) => i.status === 'planned').map((i) => ({
        id: i.id,
        label: [i.procedures?.name, i.description, i.tooth_number ? toothLabel(i.tooth_number) : null].filter(Boolean).join(' — '),
      })),
    }))
    .filter((p) => p.openItems.length > 0)
}

export function SessionDialog({ patientId, plan: givenPlan, onClose, dictate = false }: Props) {
  const { isDoctor } = useAuth()
  const { clinicId, userId, role } = useMember()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [done, setDone] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  // From the patient file no plan is given: offer the plans that still have
  // work, the one under way picked first, so done items get ticked off.
  const plans = useQuery({
    queryKey: ['open-plans', patientId],
    queryFn: () => openPlans(patientId, (n) => t('plan.tooth', { n })),
    enabled: !givenPlan,
  })
  const [pickedPlanId, setPickedPlanId] = useState<string | null>(null)
  const plan = givenPlan
    ?? (pickedPlanId === '' ? null : plans.data?.find((p) => p.id === pickedPlanId) ?? plans.data?.[0] ?? null)
  const [recallTouched, setRecallTouched] = useState(false)
  const [isRecallChoice, setIsRecall] = useState(false)
  // A visit without a plan is usually a check-up; one on a plan is treatment.
  const isRecall = recallTouched ? isRecallChoice : !plan
  const [overrideReason, setOverrideReason] = useState('')
  const [locked, setLocked] = useState(false)
  const [speaking, setSpeaking] = useState(dictate)
  const [spoken, setSpoken] = useState('')
  const [filled, setFilled] = useState(false)

  // Say what was done; the boxes below fill in. She still reads them and
  // presses save — the draft only fills the same fields she could fill by hand.
  const understand = useMutation({
    mutationFn: () => draftSession(clinicId, spoken, plan?.openItems ?? []),
    onSuccess: (d) => {
      if (d.doneItemIds.length) setDone(new Set(d.doneItemIds))
      const parts = [d.note.trim(), d.next.trim() && `${t('dict.next')}: ${d.next.trim()}`].filter(Boolean)
      if (parts.length) setNotes((n) => [n.trim(), ...parts].filter(Boolean).join('\n'))
      setFilled(true)
    },
  })
  // Who did the work. Reception saves most visits, so this has to be said
  // rather than taken from whoever is signed in.
  const [doctorId, setDoctorId] = useState(role === 'doctor' || role === 'owner' ? userId : '')
  const doctors = useQuery({ queryKey: ['clinic-doctors', clinicId], queryFn: () => getClinicDoctors(clinicId) })
  const patientDoctor = useQuery({ queryKey: ['patient-doctor', patientId], queryFn: () => getPatientDoctor(patientId) })
  useEffect(() => {
    if (!doctorId && patientDoctor.data) setDoctorId(patientDoctor.data)
  }, [patientDoctor.data, doctorId])

  const save = useMutation({
    mutationFn: () =>
      recordSession({
        patientId,
        planId: plan?.id ?? null,
        notes,
        isRecallVisit: isRecall,
        doneItemIds: [...done],
        doctorId: doctorId || null,
        override: locked ? { reason: overrideReason } : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] })
      queryClient.invalidateQueries({ queryKey: ['today'] })
      if (plan) queryClient.invalidateQueries({ queryKey: ['plan', plan.id] })
      queryClient.invalidateQueries({ queryKey: ['open-plans', patientId] })
      queryClient.invalidateQueries({ queryKey: ['tooth-history', patientId] })
      queryClient.invalidateQueries({ queryKey: ['last-visit', patientId] })
      queryClient.invalidateQueries({ queryKey: ['plan'] })
      onClose()
    },
    onError: (error) => {
      if (errorKey(error) === 'err.sessionLocked') setLocked(true)
    },
  })

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const needsDoctor = (doctors.data?.length ?? 0) > 0
  const canSubmit = !save.isPending && (!needsDoctor || !!doctorId) &&
    (!locked || (isDoctor && overrideReason.trim().length > 0))

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (canSubmit) save.mutate()
  }

  return (
    <Modal title={plan ? t('session.titlePlan', { plan: plan.title }) : t('session.titleVisit')} onClose={onClose}>
      <form onSubmit={onSubmit} className="dialog-form">
        {!speaking ? (
          <button type="button" className="btn dictate-open" onClick={() => setSpeaking(true)}>
            <Icon name="mic" /> {t('dict.sessionButton')}
          </button>
        ) : (
          <div className="dictate-panel">
            <DictateBox value={spoken} onChange={(v) => { setSpoken(v); setFilled(false) }}
              placeholder={t('dict.sessionPlaceholder')} />
            <div className="row-buttons">
              <button type="button" className="btn btn-primary" disabled={!spoken.trim() || understand.isPending}
                onClick={() => understand.mutate()}>
                {understand.isPending ? t('dict.understanding') : t('dict.fill')}
              </button>
            </div>
            {understand.isError && <ErrorNote error={understand.error} />}
            {filled && <p className="hint">{t('dict.filled')}</p>}
          </div>
        )}
        {!givenPlan && (plans.data?.length ?? 0) > 0 && (
          <label className="field">
            <span>{t('session.plan')}</span>
            <select value={plan?.id ?? ''} onChange={(e) => { setPickedPlanId(e.target.value); setDone(new Set()) }}>
              {plans.data!.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              <option value="">{t('session.noPlan')}</option>
            </select>
          </label>
        )}
        {plan && plan.openItems.length > 0 && (
          <fieldset className="checklist">
            <legend>{t('session.whatWasDone')}</legend>
            {plan.openItems.map((item) => (
              <label key={item.id} className="check">
                <input type="checkbox" checked={done.has(item.id)} onChange={() => toggle(item.id)} />
                <span>{item.label}</span>
              </label>
            ))}
          </fieldset>
        )}

        {needsDoctor && (
          <label className="field">
            <span>{t('session.doctor')}</span>
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="" disabled>{t('doc.pick')}</option>
              {doctors.data!.map((d) => <option key={d.user_id} value={d.user_id}>{d.display_name}</option>)}
            </select>
            <small className="hint">{t('session.doctorHint')}</small>
          </label>
        )}

        <label className="field">
          <span>{t('session.notes')}</span>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <label className="check">
          <input type="checkbox" checked={isRecall} onChange={(e) => { setRecallTouched(true); setIsRecall(e.target.checked) }} />
          <span>{t('session.isRecall')}</span>
        </label>

        {locked && (
          <div className="lock-note">
            <p>{isDoctor ? t('session.lockedDoctor') : t('session.lockedReception')}</p>
            {isDoctor && (
              <label className="field">
                <span>{t('session.overrideReason')}</span>
                <input required value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} maxLength={200} />
              </label>
            )}
          </div>
        )}
        {save.isError && errorKey(save.error) !== 'err.sessionLocked' && <ErrorNote error={save.error} />}

        <div className="dialog-actions">
          <button type="submit" className={`btn ${locked ? 'btn-danger' : 'btn-primary'}`} disabled={!canSubmit}>
            {save.isPending ? t('common.saving') : locked ? t('session.saveOverride') : t('session.save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Modal>
  )
}
