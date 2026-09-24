-- =====================================================================
-- Dental Clinic System — migration 0020: logo on the public pages
-- Requires: 0001–0019
--
-- The booking page and the patient form page are served to anonymous
-- visitors through these two functions, so the clinic's logo has to come
-- back with the rest of the data. Nothing else about the clinic is exposed.
-- =====================================================================

create or replace function public.booking_clinic(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare c public.clinics; v jsonb;
begin
  select * into c from public.clinics where booking_slug = lower(trim(p_slug)) and booking_enabled;
  if not found then raise exception 'BOOKING_UNAVAILABLE' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'clinic', c.name,
    'logo', c.logo_url,
    'timezone', c.timezone,
    'opens_at', c.opens_at,
    'closes_at', c.closes_at,
    'slot_minutes', c.slot_minutes,
    'min_notice_hours', c.booking_min_notice_hours,
    'horizon_days', c.booking_horizon_days,
    'today', public.clinic_today(c.id),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'minutes', p.default_duration_min) order by p.name)
      from public.procedures p
      where p.clinic_id = c.id and p.active and p.bookable_online
    ), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

create or replace function public.get_form_by_token(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
           'clinic',             c.name,
           'logo',               c.logo_url,
           'patient_first_name', split_part(p.full_name, ' ', 1),
           'kind',               t.kind,
           'title',              t.title,
           'body',               t.body,
           'expires_at',         r.expires_at)
  into v
  from public.form_requests r
  join public.form_templates t on t.id = r.template_id
  join public.patients p       on p.id = r.patient_id
  join public.clinics c        on c.id = r.clinic_id
  where r.token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
    and r.completed_at is null
    and r.expires_at > now();

  if v is null then raise exception 'This link is invalid, expired, or already used'; end if;
  return v;
end;
$$;

grant execute on function public.booking_clinic(text), public.get_form_by_token(text) to anon, authenticated;
