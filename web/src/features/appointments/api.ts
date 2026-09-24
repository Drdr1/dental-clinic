import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'
import { dayRange } from './time'

export type Appointment = Tables<'appointments'>
export type AppointmentStatus = 'booked' | 'arrived' | 'in_session' | 'done' | 'cancelled' | 'no_show'
export type DayAppointment = Appointment & { patientName: string; patientPhone: string; alerts: string | null; planTitle: string | null }

export async function getClinicCalendar(clinicId: string) {
  const [clinic, chairs] = await Promise.all([
    supabase.from('clinics').select('opens_at, closes_at, slot_minutes').eq('id', clinicId).single(),
    supabase.from('chairs').select('id, name').eq('clinic_id', clinicId).eq('active', true).order('name'),
  ])
  if (clinic.error) throw clinic.error
  if (chairs.error) throw chairs.error
  return { hours: clinic.data, chairs: chairs.data }
}

async function withPeople(rows: Appointment[]): Promise<DayAppointment[]> {
  const patientIds = [...new Set(rows.map((a) => a.patient_id))]
  const planIds = [...new Set(rows.map((a) => a.treatment_plan_id).filter((id): id is string => !!id))]
  const [patients, plans] = await Promise.all([
    patientIds.length
      ? supabase.from('patients').select('id, full_name, phone, whatsapp_phone, medical_alerts').in('id', patientIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length
      ? supabase.from('treatment_plans').select('id, title').in('id', planIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (patients.error) throw patients.error
  if (plans.error) throw plans.error
  const people = new Map((patients.data ?? []).map((p) => [p.id, p]))
  const titles = new Map((plans.data ?? []).map((p) => [p.id, p.title]))
  return rows.map((a) => {
    const p = people.get(a.patient_id)
    return {
      ...a,
      patientName: p?.full_name ?? '',
      patientPhone: p?.whatsapp_phone ?? p?.phone ?? '',
      alerts: p?.medical_alerts ?? null,
      planTitle: a.treatment_plan_id ? titles.get(a.treatment_plan_id) ?? null : null,
    }
  })
}

export async function getDay(clinicId: string, date: string): Promise<DayAppointment[]> {
  const { from, to } = dayRange(date)
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('clinic_id', clinicId)
    .gte('starts_at', from)
    .lt('starts_at', to)
    .neq('status', 'cancelled')
    .order('starts_at')
  if (error) throw error
  return withPeople(data)
}

export async function getUpcomingForPatient(patientId: string): Promise<DayAppointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('patient_id', patientId)
    .gte('starts_at', new Date(Date.now() - 12 * 3600_000).toISOString())
    .in('status', ['booked', 'arrived', 'in_session'])
    .order('starts_at')
    .limit(10)
  if (error) throw error
  return withPeople(data)
}

export async function getPatientPlans(patientId: string) {
  const { data, error } = await supabase
    .from('treatment_plans')
    .select('id, title, status')
    .eq('patient_id', patientId)
    .in('status', ['draft', 'presented', 'active'])
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export type AppointmentInput = {
  clinicId: string
  patientId: string
  chairId: string
  doctorId: string | null
  planId: string | null
  startsAt: string
  endsAt: string
  notes: string
}

export async function saveAppointment(input: AppointmentInput, id?: string) {
  const row = {
    clinic_id: input.clinicId,
    patient_id: input.patientId,
    chair_id: input.chairId,
    doctor_id: input.doctorId,
    treatment_plan_id: input.planId,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    notes: input.notes.trim() || null,
  }
  const { error } = id
    ? await supabase.from('appointments').update(row).eq('id', id)
    : await supabase.from('appointments').insert(row)
  if (error) throw error
}

export async function setAppointmentStatus(id: string, status: AppointmentStatus) {
  const { error } = await supabase.from('appointments').update({ status }).eq('id', id)
  if (error) throw error
}

/** Doctors of the clinic, for assigning appointments. */
export async function getClinicDoctors(clinicId: string) {
  const { data, error } = await supabase.from('clinic_members')
    .select('user_id, display_name, role')
    .eq('clinic_id', clinicId).eq('active', true).in('role', ['owner', 'doctor'])
    .order('display_name')
  if (error) throw error
  return data
}
