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

async function getToothHistory(patientId: string): Promise<ToothEntry[]> {
  const { data: plans, error } = await supabase.from('treatment_plans').select('id, title').eq('patient_id', patientId)
  if (error) throw error
  if (!plans.length) return []
  const [items, procedures, sessions] = await Promise.all([
    supabase.from('treatment_plan_items').select('plan_id, procedure_id, tooth_number, description, status, done_in_session_id')
      .in('plan_id', plans.map((p) => p.id)).not('tooth_number', 'is', null).neq('status', 'cancelled'),
    supabase.from('procedures').select('id, name'),
    supabase.from('sessions').select('id, performed_at').eq('patient_id', patientId),
  ])
  for (const r of [items, procedures, sessions]) if (r.error) throw r.error
  const names = new Map((procedures.data ?? []).map((p) => [p.id, p.name]))
  const when = new Map((sessions.data ?? []).map((s) => [s.id, s.performed_at]))
  const titles = new Map(plans.map((p) => [p.id, p.title]))
  return (items.data ?? []).map((i) => ({
    tooth: i.tooth_number as number,
    label: [i.procedure_id ? names.get(i.procedure_id) : null, i.description].filter(Boolean).join(' — '),
    procedure: `${i.procedure_id ? names.get(i.procedure_id) ?? '' : ''} ${i.description ?? ''}`,
    status: i.status === 'done' ? 'done' : 'planned',
    at: i.done_in_session_id ? when.get(i.done_in_session_id) ?? null : null,
    planId: i.plan_id,
    planTitle: titles.get(i.plan_id) ?? '',
  }))
}

// Simple outlines: a crown with roots for the upper jaw, the same flipped for the lower.
const UPPER_PATH = 'M5 13c0-5 2-9 7-9s7 4 7 9c0 4-1 7-2 7-1.4 0-1.6-4-5-4s-3.6 4-5 4c-1 0-2-3-2-7z'
const LOWER_PATH = 'M5 11c0 5 2 9 7 9s7-4 7-9c0-4-1-7-2-7-1.4 0-1.6 4-5 4s-3.6-4-5-4c-1 0-2 3-2 7z'

/** Chart and per-tooth history side by side, like the paper chart: tap a tooth to see what was done on it. */
export function ToothHistory({ patientId, onAddForTooth }: { patientId: string; onAddForTooth?: (tooth: number) => void }) {
  const { t, date } = useI18n()
  const [picked, setPicked] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['tooth-history', patientId], queryFn: () => getToothHistory(patientId) })

  const byTooth = new Map<number, ToothEntry[]>()
  for (const e of q.data ?? []) byTooth.set(e.tooth, [...(byTooth.get(e.tooth) ?? []), e])
  // Until someone taps a tooth, show the one worked on most recently.
  const latest = [...(q.data ?? [])].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))[0]?.tooth ?? null
  const selected = picked ?? latest
  const shown = selected ? [...(byTooth.get(selected) ?? [])].sort((a, b) => (b.at ?? '9999').localeCompare(a.at ?? '9999')) : []
  const cond = (n: number) => conditionOf(byTooth.get(n))

  const tooth = (n: number, upper: boolean) => (
    <button key={n} type="button" className={`tooth2 c-${cond(n)} ${selected === n ? 'is-selected' : ''}`}
      aria-pressed={selected === n} aria-label={`${t('plan.tooth', { n })}: ${t(`tooth.c.${cond(n)}`)}`}
      onClick={() => setPicked(n)}>
      {!upper && <span className="tooth2-n">{n}</span>}
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={upper ? UPPER_PATH : LOWER_PATH} /></svg>
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
        {q.data && q.data.length === 0 && <p className="muted">{t('tooth.empty')}</p>}
        {selected && shown.length === 0 && <p className="muted">{t('tooth.noneOnTooth', { n: selected })}</p>}
        <ul className="tooth-log">
          {shown.map((e, i) => (
            <li key={`${e.tooth}-${i}`}>
              <span className="muted small nowrap">{e.at ? date(e.at) : t('plan.itemPlanned')}</span>
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
