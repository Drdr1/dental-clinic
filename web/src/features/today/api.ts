import { supabase } from '../../lib/supabase'
import { clinicDate, todayLocal } from '../../lib/dates'
import { getDay } from '../appointments/api'
import { getLowStock } from '../materials/api'

export type DayTotal = { day: string; total: number }

/** The last seven clinic days, oldest first (YYYY-MM-DD). Noon avoids daylight-saving edges. */
function lastSevenDays(): string[] {
  const [y, m, d] = todayLocal().split('-').map(Number)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(Date.UTC(y, m - 1, d - 6 + i, 12))
    return x.toISOString().slice(0, 10)
  })
}

/** Payments summed per clinic day, oldest first, every day present even when empty. */
function byDay(days: string[], rows: { amount: number; received_at: string }[]): DayTotal[] {
  const out: DayTotal[] = days.map((day) => ({ day, total: 0 }))
  const index = new Map(days.map((d, i) => [d, i]))
  for (const r of rows) {
    const i = index.get(clinicDate(new Date(r.received_at)))
    if (i !== undefined) out[i].total += r.amount
  }
  return out
}

export async function getToday(clinicId: string) {
  const days = lastSevenDays()
  // A day early, to be safe across timezones; byDay keeps only the seven clinic days.
  const [sy, sm, sd] = days[0].split('-').map(Number)
  const since = new Date(Date.UTC(sy, sm - 1, sd - 1))
  const [agenda, recall, labs, unscheduled, appointments, lowStock, payments] = await Promise.all([
    supabase.from('installment_agenda').select('*').eq('clinic_id', clinicId).order('due_date'),
    supabase.from('recall_list').select('*').eq('clinic_id', clinicId).eq('has_upcoming_appointment', false)
      .order('next_recall_due'),
    supabase.from('lab_case_status').select('*').eq('clinic_id', clinicId)
      .is('received_on', null).is('cancelled_at', null).order('expected_on'),
    supabase.from('unscheduled_treatment').select('*').eq('clinic_id', clinicId).order('accepted_at'),
    getDay(clinicId, todayLocal()),
    getLowStock(clinicId),
    // Seven days of takings, today last: the KPI and the week chart both read it.
    supabase.from('payments').select('amount, received_at').eq('clinic_id', clinicId)
      .gte('received_at', since.toISOString()),
  ])
  for (const r of [agenda, recall, labs, unscheduled, payments]) if (r.error) throw r.error

  // Plan names for the installment rows, in one query.
  const planIds = [...new Set((agenda.data ?? []).map((a) => a.treatment_plan_id).filter((id): id is string => !!id))]
  const titles = new Map<string, string>()
  if (planIds.length) {
    const { data, error } = await supabase.from('treatment_plans').select('id, title').in('id', planIds)
    if (error) throw error
    for (const p of data) titles.set(p.id, p.title)
  }

  const week = byDay(days, payments.data ?? [])

  return {
    agenda: agenda.data ?? [],
    recall: recall.data ?? [],
    // Late at any stage, not just late coming back: a try-in that never
    // arrived is the one reception has to chase today.
    labs: (labs.data ?? []).filter((l) => l.stage_late || l.at_risk),
    unscheduled: unscheduled.data ?? [],
    planTitles: titles,
    appointments,
    lowStock,
    week,
    collectedToday: week[week.length - 1].total,
  }
}
