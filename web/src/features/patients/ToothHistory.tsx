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

/** Read-only chart: what has been done on each tooth, and what's still planned. */
export function ToothHistory({ patientId }: { patientId: string }) {
  const { t, date } = useI18n()
  const [selected, setSelected] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['tooth-history', patientId], queryFn: () => getToothHistory(patientId) })

  if (q.isPending) return <Skeleton rows={2} />
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />

  const byTooth = new Map<number, ToothEntry[]>()
  for (const e of q.data) byTooth.set(e.tooth, [...(byTooth.get(e.tooth) ?? []), e])
  const shown = selected ? byTooth.get(selected) ?? [] : q.data
  const state = (n: number) => {
    const list = byTooth.get(n)
    if (!list) return ''
    return list.some((e) => e.status === 'done') ? 'is-done' : 'is-planned'
  }

  const row = (teeth: number[]) =>
    teeth.map((n, i) => (
      <button key={n} type="button"
        className={`tooth ${state(n)} ${selected === n ? 'is-selected' : ''} ${i === 7 ? 'is-midline' : ''}`}
        aria-pressed={selected === n}
        onClick={() => setSelected(selected === n ? null : n)}>
        {n}
      </button>
    ))

  return (
    <div className="tooth-history">
      <div className="tooth-chart" dir="ltr">
        <div className="tooth-side"><span>{t('chart.right')}</span><span>{t('chart.left')}</span></div>
        <div className="tooth-row">{row(UPPER)}</div>
        <div className="tooth-row">{row(LOWER)}</div>
      </div>
      <div className="tooth-legend">
        <span><i className="swatch swatch-done" />{t('tooth.done')}</span>
        <span><i className="swatch swatch-planned" />{t('tooth.planned')}</span>
        {selected && <button className="link-btn" onClick={() => setSelected(null)}>{t('tooth.showAll')}</button>}
      </div>

      {q.data.length === 0 && <p className="muted">{t('tooth.empty')}</p>}
      {q.data.length > 0 && (
        <ul className="plan-list">
          {shown.length === 0 && <p className="muted">{t('tooth.noneOnTooth', { n: selected ?? 0 })}</p>}
          {shown.map((e, i) => (
            <li key={`${e.tooth}-${i}`}>
              <div className="plan-line">
                <span><strong>{t('plan.tooth', { n: e.tooth })}</strong> — {e.label}</span>
                <span className={`badge ${e.status === 'done' ? 'badge-ok' : 'badge-neutral'}`}>
                  {e.status === 'done' ? t('plan.itemDone') : t('plan.itemPlanned')}
                </span>
              </div>
              <p className="plan-sub muted">
                <Link to={`/plans/${e.planId}`}>{e.planTitle}</Link>
                {e.at && <> · {date(e.at)}</>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
