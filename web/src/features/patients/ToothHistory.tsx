import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'

const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

type ToothEntry = { tooth: number; label: string; status: 'done' | 'planned'; at: string | null; planId: string; planTitle: string }

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
    status: i.status === 'done' ? 'done' : 'planned',
    at: i.done_in_session_id ? when.get(i.done_in_session_id) ?? null : null,
    planId: i.plan_id,
    planTitle: titles.get(i.plan_id) ?? '',
  }))
}

// Simple outlines: a crown with roots for the upper jaw, the same flipped for the lower.
const UPPER_PATH = 'M5 13c0-5 2-9 7-9s7 4 7 9c0 4-1 7-2 7-1.4 0-1.6-4-5-4s-3.6 4-5 4c-1 0-2-3-2-7z'
const LOWER_PATH = 'M5 11c0 5 2 9 7 9s7-4 7-9c0-4-1-7-2-7-1.4 0-1.6 4-5 4s-3.6-4-5-4c-1 0-2 3-2 7z'

/** Chart and per-tooth history side by side: what was done on each tooth and what is still planned. */
export function ToothHistory({ patientId, onAddPlan }: { patientId: string; onAddPlan?: () => void }) {
  const { t, date } = useI18n()
  const [selected, setSelected] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['tooth-history', patientId], queryFn: () => getToothHistory(patientId) })

  const byTooth = new Map<number, ToothEntry[]>()
  for (const e of q.data ?? []) byTooth.set(e.tooth, [...(byTooth.get(e.tooth) ?? []), e])
  const state = (n: number) => {
    const list = byTooth.get(n)
    if (!list) return ''
    return list.some((e) => e.status === 'planned') ? 'is-planned' : 'is-done'
  }
  const shown = selected ? byTooth.get(selected) ?? [] : q.data ?? []

  const tooth = (n: number, upper: boolean) => (
    <button key={n} type="button" className={`tooth2 ${state(n)} ${selected === n ? 'is-selected' : ''}`}
      aria-pressed={selected === n} aria-label={t('plan.tooth', { n })}
      onClick={() => setSelected(selected === n ? null : n)}>
      {!upper && <span className="tooth2-n">{n}</span>}
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={upper ? UPPER_PATH : LOWER_PATH} /></svg>
      {upper && <span className="tooth2-n">{n}</span>}
    </button>
  )

  return (
    <div className="tooth-split">
      <section className="panel">
        <div className="panel-head">
          <h2>{t('tooth.title')}</h2>
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
          <span><i className="swatch swatch-none" />{t('tooth.none')}</span>
          <span><i className="swatch swatch-planned" />{t('tooth.planned')}</span>
          <span><i className="swatch swatch-done" />{t('tooth.done')}</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{selected ? t('plan.tooth', { n: selected }) : t('tooth.allWork')}</h2>
          {selected && <button className="link-btn" onClick={() => setSelected(null)}>{t('tooth.showAll')}</button>}
        </div>
        {q.data && q.data.length === 0 && <p className="muted">{t('tooth.empty')}</p>}
        {q.data && q.data.length > 0 && shown.length === 0 && <p className="muted">{t('tooth.noneOnTooth', { n: selected ?? 0 })}</p>}
        <ul className="tooth-log">
          {shown.slice(0, 12).map((e, i) => (
            <li key={`${e.tooth}-${i}`}>
              <span className="muted small nowrap">{e.at ? date(e.at) : t('plan.itemPlanned')}</span>
              <div>
                <strong>{selected ? e.label : `${t('plan.tooth', { n: e.tooth })} · ${e.label}`}</strong>
                <p className="muted small"><Link to={`/plans/${e.planId}`}>{e.planTitle}</Link></p>
              </div>
              <span className={`badge ${e.status === 'done' ? 'badge-neutral' : 'badge-info'}`}>
                {e.status === 'done' ? t('plan.itemDone') : t('plan.itemPlanned')}
              </span>
            </li>
          ))}
        </ul>
        {onAddPlan && <button className="btn" onClick={onAddPlan}>{t('plan.new')}</button>}
      </section>
    </div>
  )
}
