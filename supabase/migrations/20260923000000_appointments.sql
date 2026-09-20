-- =====================================================================
-- Dental Clinic System — migration 0005: appointments support
-- Requires: 0001–0004
--
-- 1. Clinic working hours and calendar slot size (drives the day view).
-- 2. Appointments can be linked to the treatment plan they're for.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Working hours
-- ---------------------------------------------------------------------
alter table public.clinics
  add column opens_at      time     not null default '12:00',
  add column closes_at     time     not null default '22:00',
  add column slot_minutes  smallint not null default 15 check (slot_minutes in (10, 15, 20, 30)),
  add constraint clinics_hours_valid check (closes_at > opens_at);

-- The owner can change these alongside the other settings.
grant update (opens_at, closes_at, slot_minutes) on public.clinics to authenticated;

-- ---------------------------------------------------------------------
-- 2. Appointment ↔ treatment plan
-- ---------------------------------------------------------------------
alter table public.appointments
  add column treatment_plan_id uuid,
  add foreign key (treatment_plan_id, clinic_id) references public.treatment_plans (id, clinic_id);

create index appointments_plan_idx on public.appointments (treatment_plan_id);

-- The plan must belong to the same patient as the appointment.
create or replace function public.appointment_plan_matches_patient()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.treatment_plan_id is not null and not exists (
    select 1 from public.treatment_plans
    where id = new.treatment_plan_id and patient_id = new.patient_id
  ) then
    raise exception 'Treatment plan does not belong to this patient';
  end if;
  return new;
end;
$$;

create trigger appointments_plan_matches_patient
  before insert or update of treatment_plan_id, patient_id on public.appointments
  for each row execute function public.appointment_plan_matches_patient();

revoke execute on function public.appointment_plan_matches_patient() from public, anon, authenticated;
