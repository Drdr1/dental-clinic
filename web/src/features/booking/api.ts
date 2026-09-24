import { supabase } from '../../lib/supabase'

export type BookingService = { id: string; name: string; minutes: number }
export type BookingClinic = {
  clinic: string
  logo: string | null
  timezone: string
  opens_at: string
  closes_at: string
  slot_minutes: number
  min_notice_hours: number
  horizon_days: number
  today: string
  services: BookingService[]
}

/** Public: everything the booking page needs, no login. */
export async function getBookingClinic(slug: string): Promise<BookingClinic> {
  const { data, error } = await supabase.rpc('booking_clinic', { p_slug: slug })
  if (error) throw error
  return data as unknown as BookingClinic
}

export async function getSlots(slug: string, date: string, procedureId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('booking_slots', { p_slug: slug, p_date: date, p_procedure: procedureId })
  if (error) throw error
  return ((data ?? []) as Array<{ slot: string } | string>).map((r) => (typeof r === 'string' ? r : r.slot))
}

export async function book(args: {
  slug: string; procedureId: string; start: string; name: string; phone: string; note: string
}) {
  const { data, error } = await supabase.rpc('book_appointment', {
    p_slug: args.slug, p_procedure: args.procedureId, p_start: args.start,
    p_name: args.name, p_phone: args.phone, p_note: args.note || undefined,
  })
  if (error) throw error
  return data as unknown as { id: string; starts_at: string; clinic: string; minutes: number }
}

// ---- staff side ----
export type PendingBooking = {
  id: string; patient_id: string; starts_at: string; ends_at: string
  booked_name: string | null; notes: string | null
  full_name: string; phone: string; whatsapp_phone: string | null
  service_name: string | null; created_at: string
}

export async function getPendingBookings(clinicId: string): Promise<PendingBooking[]> {
  const { data, error } = await supabase.from('pending_bookings').select('*').eq('clinic_id', clinicId)
  if (error) throw error
  return data as PendingBooking[]
}

export async function confirmBooking(id: string) {
  const { error } = await supabase.rpc('confirm_booking', { p_appointment: id })
  if (error) throw error
}
