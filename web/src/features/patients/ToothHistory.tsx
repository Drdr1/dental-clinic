import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'

const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

type ToothEntry = { tooth: number; label: string; procedure: string; status: 'done' | 'planned'; at: string | null; planId: string; planTitle: string }

/** What the chart paints a tooth as. Read from the procedures done on it, so nothing extra has to be recorded. */
export type ToothCondition = 'healthy' | 'needs' | 'filling' | 'root_canal' | 'crown' | 'missing'
const KIND: [ToothCondition, RegExp][] = [
  ['missing', /خلع|extract/i],
  ['crown', /تاج|كراون|زيركون|كوبري|بريدج|فينير|crown|bridge|veneer|zircon/i],
  ['root_canal', /عصب|root|rct|endo/i],
  ['filling', /حشو|filling|composite|amalgam/i],
]
const RANK: ToothCondition[] = ['missing', 'crown', 'root_canal', 'filling']
function conditionOf(list: ToothEntry[] | undefined): ToothCondition {
  if (!list?.length) return 'healthy'
  const done = list.filter((e) => e.status === 'done')
  if (!done.length) return 'needs'
  const kinds = done.map((e) => KIND.find(([, re]) => re.test(e.procedure))?.[0]).filter((k): k is ToothCondition => !!k)
  return RANK.find((k) => kinds.includes(k)) ?? (list.some((e) => e.status === 'planned') ? 'needs' : 'filling')
}

type ToothSession = { id: string; at: string; planId: string | null; doctor: string; notes: string }
type ToothData = { entries: ToothEntry[]; sessions: ToothSession[] }

async function getToothHistory(patientId: string): Promise<ToothData> {
  const [plansRes, sessions] = await Promise.all([
    supabase.from('treatment_plans').select('id, title, clinic_id').eq('patient_id', patientId),
    supabase.from('sessions').select('id, performed_at, treatment_plan_id, doctor_id, performed_by, notes')
      .eq('patient_id', patientId).order('performed_at'),
  ])
  if (plansRes.error) throw plansRes.error
  if (sessions.error) throw sessions.error
  const plans = plansRes.data
  const clinicId = plans[0]?.clinic_id
  const [items, procedures, staff] = await Promise.all([
    plans.length
      ? supabase.from('treatment_plan_items').select('plan_id, procedure_id, tooth_number, description, status, done_in_session_id')
        .in('plan_id', plans.map((p) => p.id)).not('tooth_number', 'is', null).neq('status', 'cancelled')
      : Promise.resolve({ data: [], error: null }),
    supabase.from('procedures').select('id, name'),
    clinicId
      ? supabase.from('clinic_members').select('user_id, display_name').eq('clinic_id', clinicId)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of [items, procedures, staff]) if (r.error) throw r.error
  const names = new Map((procedures.data ?? []).map((p) => [p.id, p.name]))
  const when = new Map((sessions.data ?? []).map((s) => [s.id, s.performed_at]))
  const titles = new Map(plans.map((p) => [p.id, p.title]))
  const people = new Map((staff.data ?? []).map((m) => [m.user_id, m.display_name]))
  return {
    entries: (items.data ?? []).map((i) => ({
      tooth: i.tooth_number as number,
      label: [i.procedure_id ? names.get(i.procedure_id) : null, i.description].filter(Boolean).join(' — '),
      procedure: `${i.procedure_id ? names.get(i.procedure_id) ?? '' : ''} ${i.description ?? ''}`,
      status: i.status === 'done' ? 'done' : 'planned',
      at: i.done_in_session_id ? when.get(i.done_in_session_id) ?? null : null,
      planId: i.plan_id,
      planTitle: titles.get(i.plan_id) ?? '',
    })),
    sessions: (sessions.data ?? []).map((s) => ({
      id: s.id, at: s.performed_at, planId: s.treatment_plan_id,
      doctor: people.get(s.doctor_id ?? s.performed_by ?? '') ?? '',
      notes: (s.notes ?? '').trim(),
    })),
  }
}

// The design's tooth: one outline, flipped for the lower jaw.
const TOOTH_PATH = 'M6 22 Q6 4 14 3 Q22 4 22 22 Q26 24 25 31 Q24 38 14 38 Q4 38 3 31 Q2 24 6 22 Z'

/** Chart and per-tooth history side by side, like the paper chart: tap a tooth to see what was done on it. */
export function ToothHistory({ patientId, onAddForTooth }: { patientId: string; onAddForTooth?: (tooth: number) => void }) {
  const { t, day } = useI18n()
  const [picked, setPicked] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['tooth-history', patientId], queryFn: () => getToothHistory(patientId) })

  const entries = q.data?.entries ?? []
  const byTooth = new Map<number, ToothEntry[]>()
  for (const e of entries) byTooth.set(e.tooth, [...(byTooth.get(e.tooth) ?? []), e])
  // Until someone taps a tooth, show the one worked on most recently.
  const latest = [...entries].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))[0]?.tooth ?? null
  const selected = picked ?? latest
  // The visits on this tooth: every session of a plan that has work on it, newest first,
  // numbered within the plan ("حشو عصب، الجلسة 2") as the doctor would say it.
  const toothItems = selected ? byTooth.get(selected) ?? [] : []
  const planIds = new Set(toothItems.map((e) => e.planId))
  const visits = (q.data?.sessions ?? []).filter((s) => s.planId && planIds.has(s.planId)).map((s) => {
    const inPlan = (q.data?.sessions ?? []).filter((x) => x.planId === s.planId)
    const what = [...new Set(toothItems.filter((e) => e.planId === s.planId).map((e) => e.label))].join('، ')
    return { ...s, title: inPlan.length > 1 ? t('tooth.sessionN', { what, n: inPlan.indexOf(s) + 1 }) : what }
  }).reverse()
  const planned = toothItems.filter((e) => e.status === 'planned')
  const cond = (n: number) => conditionOf(byTooth.get(n))

  const tooth = (n: number, upper: boolean) => (
    <button key={n} type="button" className={`tooth2 c-${cond(n)} ${selected === n ? 'is-selected' : ''}`}
      aria-pressed={selected === n} aria-label={`${t('plan.tooth', { n })}: ${t(`tooth.c.${cond(n)}`)}`}
      onClick={() => setPicked(n)}>
      {!upper && <span className="tooth2-n">{n}</span>}
      <svg viewBox="0 0 28 40" aria-hidden="true">
        <rect x="0" y="0" width="28" height="40" rx="6" className="tooth2-bg" />
        <path d={TOOTH_PATH} transform={upper ? undefined : 'translate(0 40) scale(1 -1)'} />
      </svg>
      {upper && <span className="tooth2-n">{n}</span>}
    </button>
  )

  return (
    <div className="tooth-split">
      <section className="panel">
        <div className="panel-head">
          <h2>{t('tooth.chartTitle')}</h2>
          <span className="muted small">{t('tooth.hint')}</span>
        </div>
        {q.isPending && <Skeleton rows={2} />}
        {q.isError && <ErrorNote error={q.error} onRetry={() => q.refetch()} />}
        {q.data && (
          <div className="tooth-chart2" dir="ltr">
            <div className="tooth-side"><span>{t('chart.right')}</span><span>{t('chart.left')}</span></div>
            <div className="tooth-row2">{UPPER.map((n) => tooth(n, true))}</div>
            <div className="tooth-row2 is-lower">{LOWER.map((n) => tooth(n, false))}</div>
          </div>
        )}
        <div className="tooth-legend">
          {(['healthy', 'needs', 'filling', 'root_canal', 'crown', 'missing'] as const).map((c) => (
            <span key={c}><i className={`swatch c-${c}`} />{t(`tooth.c.${c}`)}</span>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{selected ? t('tooth.toothN', { n: selected }) : t('tooth.allWork')}</h2>
          {selected && cond(selected) !== 'healthy' && <span className={`badge tb-${cond(selected)}`}>{t(`tooth.c.${cond(selected)}`)}</span>}
        </div>
        {q.data && entries.length === 0 && <p className="muted">{t('tooth.empty')}</p>}
        {selected && visits.length === 0 && planned.length === 0 && <p className="muted">{t('tooth.noneOnTooth', { n: selected })}</p>}
        <ul className="tooth-log">
          {visits.map((v) => (
            <li key={v.id}>
              <span className="muted small nowrap">{day(v.at)}</span>
              <div>
                <strong>{v.title}</strong>
                {(v.doctor || v.notes) && <p className="muted small">{[v.doctor, v.notes].filter(Boolean).join(' · ')}</p>}
              </div>
            </li>
          ))}
          {planned.map((e, i) => (
            <li key={`p-${i}`}>
              <span className="muted small nowrap">{t('plan.itemPlanned')}</span>
              <div>
                <strong>{e.label}</strong>
                <p className="muted small"><Link to={`/plans/${e.planId}`}>{e.planTitle}</Link></p>
              </div>
            </li>
          ))}
        </ul>
        {selected && onAddForTooth && (
          <button className="btn btn-block" onClick={() => onAddForTooth(selected)}>{t('tooth.addForTooth')}</button>
        )}
      </section>
    </div>
  )
}
