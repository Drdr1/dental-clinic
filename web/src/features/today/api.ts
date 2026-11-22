import { supabase } from '../../lib/supabase'
import { todayLocal } from '../../lib/dates'
import { getDay } from '../appointments/api'
import { getLowStock } from '../materials/api'

export type DayTotal = { day: string; total: number }

function weekStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6); return d
}
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Payments summed per local calendar day, oldest first, every day present even when empty. */
function byDay(rows: { amount: number; received_at: string }[]): DayTotal[] {
  const start = weekStart()
  const days: DayTotal[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i); return { day: localDay(d), total: 0 }
  })
  const index = new Map(days.map((d, i) => [d.day, i]))
  for (const r of rows) {
    const i = index.get(localDay(new Date(r.received_at)))
    if (i !== undefined) days[i].total += r.amount
  }
  return days
}

export async function getToday(clinicId: string) {
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
      .gte('received_at', weekStart().toISOString()),
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

  const week = byDay(payments.data ?? [])

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
