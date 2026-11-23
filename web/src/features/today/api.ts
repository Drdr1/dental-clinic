import { supabase } from '../../lib/supabase'
import { todayLocal } from '../../lib/dates'
import { getClinicCalendar, getClinicDoctors, getDay } from '../appointments/api'
import { getLowStock } from '../materials/api'

/** Local midnight, `daysAgo` days back. */
function dayStart(daysAgo: number) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d
}

export type TodayData = Awaited<ReturnType<typeof getToday>>

export async function getToday(clinicId: string) {
  const [agenda, recall, labs, unscheduled, appointments, lowStock, payments, calendar, doctors] = await Promise.all([
    supabase.from('installment_agenda').select('*').eq('clinic_id', clinicId).order('due_date'),
    supabase.from('recall_list').select('*').eq('clinic_id', clinicId).eq('has_upcoming_appointment', false)
      .order('next_recall_due'),
    supabase.from('lab_case_status').select('*').eq('clinic_id', clinicId)
      .is('received_on', null).is('cancelled_at', null).order('expected_on'),
    supabase.from('unscheduled_treatment').select('*').eq('clinic_id', clinicId).order('accepted_at'),
    getDay(clinicId, todayLocal()),
    getLowStock(clinicId),
    // Eight days of collections: today's total for the tile, a week for the chart,
    // and the same weekday last week to compare today against.
    supabase.from('payments').select('amount, received_at, patient_id').eq('clinic_id', clinicId)
      .gte('received_at', dayStart(7).toISOString()),
    getClinicCalendar(clinicId),
    getClinicDoctors(clinicId),
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

  // Seven local days, oldest first, the last one being today.
  const week = Array.from({ length: 7 }, (_, i) => ({ day: dayStart(6 - i), amount: 0 }))
  let weekAgo = 0
  // What each of today's patients paid today, for the note beside their appointment.
  const paidToday = new Map<string, number>()
  for (const p of payments.data ?? []) {
    const at = new Date(p.received_at).getTime()
    if (at < week[0].day.getTime()) { weekAgo += p.amount; continue }
    for (let i = 6; i >= 0; i--) {
      if (at >= week[i].day.getTime()) { week[i].amount += p.amount; break }
    }
    if (at >= week[6].day.getTime()) paidToday.set(p.patient_id, (paidToday.get(p.patient_id) ?? 0) + p.amount)
  }

  // What today's patients still owe, for the same note.
  const todaysPatients = [...new Set(appointments.map((a) => a.patient_id))]
  const owed = new Map<string, number>()
  if (todaysPatients.length) {
    const { data, error } = await supabase.from('patient_balance').select('patient_id, outstanding').in('patient_id', todaysPatients)
    if (error) throw error
    for (const b of data) if (b.patient_id && (b.outstanding ?? 0) > 0) owed.set(b.patient_id, b.outstanding ?? 0)
  }

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
    collectedToday: week[6].amount,
    week,
    weekAgo,
    paidToday,
    owed,
    chairs: calendar.chairs,
    doctorNames: new Map(doctors.map((d) => [d.user_id, d.display_name])),
  }
}
