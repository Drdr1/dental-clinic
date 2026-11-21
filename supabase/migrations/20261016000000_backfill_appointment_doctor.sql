-- =====================================================================
-- Dental Clinic System — migration 0028: no appointment left in limbo
-- Requires: 0001–0027
--
-- A doctor's calendar shows his own appointments. Anything booked
-- without a doctor therefore showed on nobody's calendar — reception
-- could see it, the doctor could not. The app no longer lets one be
-- created that way; this hands the existing ones to a doctor.
--
-- Each goes to the patient's own doctor. Where the patient has none
-- (an online booking from a stranger, say), it is left alone on
-- purpose: reception assigns it when confirming, rather than the
-- database guessing.
-- =====================================================================

update public.appointments a
set doctor_id = p.primary_doctor_id
from public.patients p
where p.id = a.patient_id
  and a.doctor_id is null
  and p.primary_doctor_id is not null
  and a.status not in ('cancelled', 'no_show');
