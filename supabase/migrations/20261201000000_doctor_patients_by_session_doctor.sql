-- A doctor's patients include everyone she treated, counted by the doctor the
-- visit was recorded for, not by whoever typed it in (often reception). So a
-- doctor who sees a colleague's patient finds that patient in her own list,
-- while the patient keeps their usual doctor.
create or replace function public.doctor_patients(p_clinic uuid, p_doctor uuid)
returns table(patient_id uuid, full_name text, phone text, assigned boolean, sessions bigint, last_visit timestamptz, outstanding numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
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
    where se.patient_id = p.id and coalesce(se.doctor_id, se.performed_by) = p_doctor
  ) s on true
  left join public.patient_balance b on b.patient_id = p.id
  where p.clinic_id = p_clinic
    and p.archived_at is null
    and (p.primary_doctor_id = p_doctor or coalesce(s.n, 0) > 0)
  order by s.last_at desc nulls last, p.full_name;
end;
$$;
