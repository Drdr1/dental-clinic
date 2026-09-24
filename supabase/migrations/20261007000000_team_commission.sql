-- =====================================================================
-- Dental Clinic System — migration 0019: show the team's real settings
-- Requires: 0001–0018
--
-- clinic_team() never returned commission_percent, so the Settings table
-- always showed 0 and saved values looked lost. It now returns the
-- commission and the profile fields the doctors page uses.
-- =====================================================================

drop function if exists public.clinic_team(uuid);

create or replace function public.clinic_team(p_clinic uuid)
returns table (
  user_id            uuid,
  display_name       text,
  role               public.member_role,
  active             boolean,
  email              text,
  last_sign_in       timestamptz,
  created_at         timestamptz,
  commission_percent numeric,
  specialty          text,
  phone              text,
  registration_no    text
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can manage the team' using errcode = '42501';
  end if;

  return query
  select m.user_id, m.display_name, m.role, m.active,
         u.email::text, u.last_sign_in_at, m.created_at,
         m.commission_percent, m.specialty, m.phone, m.registration_no
  from public.clinic_members m
  join auth.users u on u.id = m.user_id
  where m.clinic_id = p_clinic
  order by m.active desc, m.created_at;
end;
$$;

grant execute on function public.clinic_team(uuid) to authenticated;
