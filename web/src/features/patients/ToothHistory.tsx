import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../i18n'
import { ErrorNote } from '../../components/ErrorNote'
import { Skeleton } from '../../components/Skeleton'
import { ToothSide, ToothTop, type ToothKind, type ToothStatus } from '../../components/ToothFigure'

const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

type ToothEntry = {
  tooth: number; label: string; procedure: string; status: 'done' | 'planned'; at: string | null
  planId: string; planTitle: string; planStatus: string
  /** Work over several visits: how many it takes and which session each visit was. */
  sessionsNeeded: number; steps: { sessionId: string; step: number }[]
}

/** What the chart paints a tooth as. Read from the procedures done on it, so nothing extra has to be recorded. */
export type ToothCondition = 'healthy' | 'needs' | 'filling' | 'root_canal' | 'crown' | 'implant' | 'missing'
const KIND: [ToothCondition, RegExp][] = [
  ['implant', /زرع|implant/i],
  ['missing', /خلع|extract/i],
  ['crown', /تاج|كراون|زيركون|كوبري|بريدج|فينير|crown|bridge|veneer|zircon/i],
  ['root_canal', /عصب|بلب|بوست|root|rct|endo|pulp|\bpost\b/i],
  ['filling', /حشو|filling|composite|amalgam/i],
]
// When several things were done on one tooth, the one that shows on the chart.
const RANK: ToothCondition[] = ['implant', 'missing', 'crown', 'root_canal', 'filling']
// Work still to do counts only on a plan that is proposed or under way, not a
// draft the doctor is still writing, nor a plan that was turned down or closed.
const OPEN_PLAN = new Set(['presented', 'active'])

// Finished work stays green for a month; after that it is simply what the
// mouth has (قائم).
const RECENT_MS = 30 * 24 * 3600 * 1000

function kindOf(list: ToothEntry[]): Exclude<ToothCondition, 'healthy' | 'needs'> | null {
  const kinds = list.map((e) => KIND.find(([, re]) => re.test(e.procedure))?.[0]).filter((k): k is ToothCondition => !!k)
  return (RANK.find((k) => kinds.includes(k)) ?? null) as Exclude<ToothCondition, 'healthy' | 'needs'> | null
}

/** Where the tooth stands (the colour) and what was or will be done (the mark). */
function toothState(list: ToothEntry[] | undefined, now: number): { status: ToothStatus; kind: ToothKind; cond: ToothCondition } {
  if (!list?.length) return { status: 'healthy', kind: 'none', cond: 'healthy' }
  const open = list.filter((e) => e.status === 'planned' && OPEN_PLAN.has(e.planStatus))
  const started = open.filter((e) => e.steps.length > 0)
  const done = list.filter((e) => e.status === 'done')
  // Anything still to do on the tooth comes first: that is what the doctor needs to see.
  if (open.length) {
    const k = kindOf(started.length ? started : open)
    return { status: started.length ? 'progress' : 'planned', kind: k ?? 'none', cond: 'needs' }
  }
  const k = kindOf(done)
  // Done work that leaves no mark (a cleaning, say) keeps the tooth healthy.
  if (!done.length || !k) return { status: 'healthy', kind: 'none', cond: 'healthy' }
  const recent = done.some((e) => e.at && now - new Date(e.at).getTime() < RECENT_MS)
  return { status: recent ? 'done' : 'existing', kind: k, cond: k }
}

type ToothSession = { id: string; at: string; planId: string | null; doctor: string; notes: string }
type ToothData = { entries: ToothEntry[]; sessions: ToothSession[] }

async function getToothHistory(patientId: string): Promise<ToothData> {
  const [plansRes, sessions] = await Promise.all([
    supabase.from('treatment_plans').select('id, title, clinic_id, status').eq('patient_id', patientId),
    supabase.from('sessions').select('id, performed_at, treatment_plan_id, doctor_id, performed_by, notes')
      .eq('patient_id', patientId).order('performed_at'),
  ])
  if (plansRes.error) throw plansRes.error
  if (sessions.error) throw sessions.error
  const plans = plansRes.data
  const clinicId = plans[0]?.clinic_id
  const [items, procedures, staff] = await Promise.all([
    plans.length
      ? supabase.from('treatment_plan_items').select('plan_id, procedure_id, tooth_number, description, status, done_in_session_id, sessions_needed, plan_item_steps(session_id, step)')
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
  const statuses = new Map(plans.map((p) => [p.id, p.status as string]))
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
      planStatus: statuses.get(i.plan_id) ?? '',
      sessionsNeeded: i.sessions_needed ?? 1,
      steps: (i.plan_item_steps ?? []).map((x) => ({ sessionId: x.session_id, step: x.step })),
    })),
    sessions: (sessions.data ?? []).map((s) => ({
      id: s.id, at: s.performed_at, planId: s.treatment_plan_id,
      doctor: people.get(s.doctor_id ?? s.performed_by ?? '') ?? '',
      notes: (s.notes ?? '').trim(),
    })),
  }
}

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
    // Work over several visits says its own session: "تاج زيركون، الجلسة 2 من 3".
    const staged = toothItems.filter((e) => e.sessionsNeeded > 1)
      .map((e) => ({ e, step: e.steps.find((x) => x.sessionId === s.id)?.step }))
      .filter((x) => x.step)
    if (staged.length) {
      return { ...s, title: staged.map(({ e, step }) => t('tooth.stepOf', { what: e.label, n: step!, of: e.sessionsNeeded })).join(' · ') }
    }
    const what = [...new Set(toothItems.filter((e) => e.planId === s.planId).map((e) => e.label))].join('، ')
    return { ...s, title: inPlan.length > 1 ? t('tooth.sessionN', { what, n: inPlan.indexOf(s) + 1 }) : what }
  }).reverse()
  const planned = toothItems.filter((e) => e.status === 'planned' && OPEN_PLAN.has(e.planStatus))
  const [now] = useState(() => Date.now())
  // The tooth under the pointer (or just tapped): a small card with where its work stands.
  const [peek, setPeek] = useState<number | null>(null)
  useEffect(() => {
    if (peek == null) return
    const close = (e: PointerEvent) => { if (!(e.target as Element).closest('.tooth3')) setPeek(null) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [peek])

  const peekCard = (n: number, col: number) => {
    const list = (byTooth.get(n) ?? []).filter((e) => e.status === 'done' || OPEN_PLAN.has(e.planStatus))
    const st = state(n)
    return (
      <div className={`tooth-peek ${col < 3 ? 'at-start' : col > 12 ? 'at-end' : ''}`} role="tooltip" dir="rtl">
        <div className="tooth-peek-head">
          <strong>{t('tooth.toothN', { n })}</strong>
          <span className={`badge tb3 st-${st.status}`}>{t(`tooth.st.${st.status}`)}</span>
        </div>
        {list.length === 0 && (
          <p className="muted small">{onAddForTooth && !byTooth.has(n) ? t('tooth.tapToAdd') : t('tooth.noneOnTooth', { n })}</p>
        )}
        {list.map((e, i) => {
          const k = e.status === 'done' ? e.sessionsNeeded : e.steps.length
          return (
            <div key={i} className="tooth-peek-item">
              <div className="tooth-peek-row">
                <span>{e.label}</span>
                <span className="muted small nowrap">
                  {e.status === 'done' ? (e.at ? t('tooth.doneOn', { date: day(e.at) }) : t('plan.itemDone'))
                    : e.sessionsNeeded > 1 ? t('plan.stepsDone', { n: k, of: e.sessionsNeeded })
                    : t('plan.itemPlanned')}
                </span>
              </div>
              {e.sessionsNeeded > 1 && (
                <div className="peek-steps" aria-hidden="true">
                  {Array.from({ length: e.sessionsNeeded }, (_, j) => (
                    <i key={j} className={j < k ? (e.status === 'done' ? 'on-done' : 'on') : ''} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }
  const state = (n: number) => toothState(byTooth.get(n), now)

  const tooth = (n: number, upper: boolean, col: number) => {
    const st = state(n)
    const label = `${t('plan.tooth', { n })}: ${t(`tooth.st.${st.status}`)}${st.kind !== 'none' ? ` · ${t(`tooth.c.${st.kind}`)}` : ''}`
    const num = <span className={`tf-n st-${st.status}`}>{n}</span>
    return (
      <button key={n} type="button" className={`tooth3 ${upper ? 'is-upper' : 'is-lower'} ${selected === n ? 'is-selected' : ''}`}
        aria-pressed={selected === n} aria-label={label}
        onMouseEnter={() => setPeek(n)} onMouseLeave={() => setPeek((p) => (p === n ? null : p))}
        onFocus={() => setPeek(n)} onBlur={() => setPeek((p) => (p === n ? null : p))}
        onClick={() => {
          // Nothing on this tooth yet: the click means "add work here".
          if (onAddForTooth && !byTooth.has(n)) { onAddForTooth(n); return }
          setPicked(n); setPeek(n)
        }}>
        {peek === n && peekCard(n, col)}
        {upper ? <><ToothSide n={n} status={st.status} kind={st.kind} /><ToothTop n={n} status={st.status} kind={st.kind} />{num}</>
          : <>{num}<ToothTop n={n} status={st.status} kind={st.kind} /><ToothSide n={n} status={st.status} kind={st.kind} /></>}
      </button>
    )
  }

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
          <div className="tooth-chart3">
            <div className="tooth-scroll">
              <div className="tooth-row3" dir="ltr">{UPPER.map((n, i) => tooth(n, true, i))}</div>
              <div className="jaw-line"><span>{t('tooth.upperJaw')}</span><i /><span>{t('tooth.lowerJaw')}</span></div>
              <div className="tooth-row3" dir="ltr">{LOWER.map((n, i) => tooth(n, false, i))}</div>
            </div>
            <div className="tooth-side" dir="ltr"><span>{t('chart.right')}</span><span>{t('chart.left')}</span></div>
          </div>
        )}
        <div className="tooth-legend tooth-legend3">
          {(['done', 'progress', 'planned', 'existing'] as const).map((c) => (
            <span key={c}><i className={`dot st-${c}`} />{t(`tooth.st.${c}`)}</span>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{selected ? t('tooth.toothN', { n: selected }) : t('tooth.allWork')}</h2>
          {selected && (() => {
            const sel = state(selected)
            if (sel.status === 'healthy') return null
            return (
              <span className={`badge tb3 st-${sel.status}`}>
                {[t(`tooth.st.${sel.status}`), sel.kind !== 'none' ? t(`tooth.c.${sel.kind}`) : null].filter(Boolean).join(' · ')}
              </span>
            )
          })()}
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
