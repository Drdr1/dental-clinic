-- =====================================================================
-- Dental Clinic System — migration 0006: settings & team
-- Requires: 0001–0005
--
-- 1. clinic_team(): the owner's view of the team, including login emails
--    (emails live in auth.users, which the browser can't read).
-- 2. A clinic can never lose its last active owner (by deactivation,
--    role change or deletion), so nobody gets locked out of settings.
-- 3. Staff can't edit their own membership row (role / active).
-- =====================================================================

create or replace function public.clinic_team(p_clinic uuid)
returns table (
  user_id      uuid,
  display_name text,
  role         public.member_role,
  active       boolean,
  email        text,
  last_sign_in timestamptz,
  created_at   timestamptz
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can manage the team' using errcode = '42501';
  end if;
  return query
    select m.user_id, m.display_name, m.role, m.active, u.email::text, u.last_sign_in_at, m.created_at
    from public.clinic_members m
    join auth.users u on u.id = m.user_id
    where m.clinic_id = p_clinic
    order by m.active desc, m.role, m.display_name;
end;
$$;

revoke execute on function public.clinic_team(uuid) from public, anon;
grant  execute on function public.clinic_team(uuid) to authenticated;

create or replace function public.protect_last_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_clinic uuid := coalesce(old.clinic_id, new.clinic_id);
begin
  -- Only matters when an active owner stops being one.
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active) then
    if not exists (
      select 1 from public.clinic_members
      where clinic_id = v_clinic and role = 'owner' and active and user_id <> old.user_id
    ) then
      raise exception 'LAST_OWNER: a clinic must keep at least one active owner';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger clinic_members_protect_last_owner
  before update or delete on public.clinic_members
  for each row execute function public.protect_last_owner();

-- Staff can't change their own role or reactivate themselves; only the owner edits members,
-- and even the owner can't demote or deactivate their own row (the trigger above covers the
-- last-owner case; this covers accidental self-lockout when there are several owners).
create or replace function public.no_self_membership_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.user_id = auth.uid()
     and (new.role is distinct from old.role or new.active is distinct from old.active) then
    raise exception 'SELF_CHANGE: you can''t change your own role or deactivate yourself';
  end if;
  return new;
end;
$$;

create trigger clinic_members_no_self_change
  before update on public.clinic_members
  for each row execute function public.no_self_membership_change();

revoke execute on function public.protect_last_owner()        from public, anon, authenticated;
revoke execute on function public.no_self_membership_change() from public, anon, authenticated;
