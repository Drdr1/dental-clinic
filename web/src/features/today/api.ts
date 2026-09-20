import { supabase } from '../../lib/supabase'
import { todayLocal } from '../../lib/dates'
import { getDay } from '../appointments/api'
import { getLowStock } from '../materials/api'

export async function getToday(clinicId: string) {
  const [agenda, recall, labs, unscheduled, appointments, lowStock] = await Promise.all([
    supabase.from('installment_agenda').select('*').eq('clinic_id', clinicId).order('due_date'),
    supabase.from('recall_list').select('*').eq('clinic_id', clinicId).eq('has_upcoming_appointment', false)
      .order('next_recall_due'),
    supabase.from('lab_case_status').select('*').eq('clinic_id', clinicId)
      .is('received_on', null).is('cancelled_at', null).order('expected_on'),
    supabase.from('unscheduled_treatment').select('*').eq('clinic_id', clinicId).order('accepted_at'),
    getDay(clinicId, todayLocal()),
    getLowStock(clinicId),
  ])
  for (const r of [agenda, recall, labs, unscheduled]) if (r.error) throw r.error

  // Plan names for the installment rows, in one query.
  const planIds = [...new Set((agenda.data ?? []).map((a) => a.treatment_plan_id).filter((id): id is string => !!id))]
  const titles = new Map<string, string>()
  if (planIds.length) {
    const { data, error } = await supabase.from('treatment_plans').select('id, title').in('id', planIds)
    if (error) throw error
    for (const p of data) titles.set(p.id, p.title)
  }

  return {
    agenda: agenda.data ?? [],
    recall: recall.data ?? [],
    labs: (labs.data ?? []).filter((l) => l.status === 'late' || l.at_risk),
    unscheduled: unscheduled.data ?? [],
    planTitles: titles,
    appointments,
    lowStock,
  }
}
