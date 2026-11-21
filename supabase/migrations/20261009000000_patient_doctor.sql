-- =====================================================================
-- Dental Clinic System — migration 0021: the patient's doctor
-- Requires: 0001–0020
--
-- A patient now has a treating doctor, shown on their file and used to
-- list "their patients" on the doctor's page. Two different questions get
-- two different answers there:
--   assigned  → patients.primary_doctor_id (who follows this patient)
--   treated   → who actually performed sessions (from sessions.performed_by)
-- =====================================================================

alter table public.patients
  add column primary_doctor_id uuid,
  add foreign key (clinic_id, primary_doctor_id) references public.clinic_members (clinic_id, user_id);

create index patients_doctor_idx on public.patients (clinic_id, primary_doctor_id)
  where archived_at is null;

-- Patients of one doctor: assigned to them, or treated by them.
create or replace function public.doctor_patients(p_clinic uuid, p_doctor uuid)
returns table (
  patient_id   uuid,
  full_name    text,
  phone        text,
  assigned     boolean,
  sessions     bigint,
  last_visit   timestamptz,
  outstanding  numeric
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_member(p_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;

  return query
  select p.id, p.full_name, p.phone,
         p.primary_doctor_id = p_doctor,
         coalesce(s.n, 0),
         s.last_at,
         coalesce(b.outstanding, 0)
  from public.patients p
  left join lateral (
    select count(*) as n, max(se.performed_at) as last_at
    from public.sessions se
    where se.patient_id = p.id and se.performed_by = p_doctor
  ) s on true
  left join public.patient_balance b on b.patient_id = p.id
  where p.clinic_id = p_clinic
    and p.archived_at is null
    and (p.primary_doctor_id = p_doctor or coalesce(s.n, 0) > 0)
  order by s.last_at desc nulls last, p.full_name;
end;
$$;

grant execute on function public.doctor_patients(uuid, uuid) to authenticated;
