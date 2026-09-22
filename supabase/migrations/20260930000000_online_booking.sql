-- =====================================================================
-- Dental Clinic System — migration 0012: online booking
-- Requires: 0001–0011
--
-- A public page (no login) where a patient picks a service and a free time.
-- Everything is enforced here, not in the browser:
--   * booking on/off, per-clinic link slug
--   * only procedures the clinic marks as bookable online
--   * clinic opening hours and slot size from Settings
--   * a daily cap on online bookings, so walk-ins still fit
--   * minimum notice, booking horizon, max 2 unconfirmed per phone
--   * the chair exclusion constraint prevents double booking under load
--
-- Online bookings arrive as normal appointments with source = 'online' and
-- confirmed_at = null, so reception sees them and calls to confirm.
-- =====================================================================

alter table public.clinics
  add column booking_enabled          boolean  not null default false,
  add column booking_slug             text unique,
  add column booking_daily_limit      smallint not null default 6  check (booking_daily_limit between 0 and 100),
  add column booking_min_notice_hours smallint not null default 4  check (booking_min_notice_hours between 0 and 168),
  add column booking_horizon_days     smallint not null default 30 check (booking_horizon_days between 1 and 180),
  add constraint clinics_booking_slug_format
    check (booking_slug is null or booking_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

grant update (booking_enabled, booking_slug, booking_daily_limit,
              booking_min_notice_hours, booking_horizon_days) on public.clinics to authenticated;

alter table public.procedures
  add column bookable_online boolean not null default false;

alter table public.appointments
  add column source        text not null default 'clinic' check (source in ('clinic', 'online')),
  add column confirmed_at  timestamptz,
  add column booked_name   text,   -- what the patient typed, kept as-is for reception
  add column procedure_id  uuid,
  add foreign key (procedure_id, clinic_id) references public.procedures (id, clinic_id);

create index appointments_pending_online_idx on public.appointments (clinic_id, starts_at)
  where source = 'online' and confirmed_at is null;

-- ---------------------------------------------------------------------
-- Public read: what the booking page needs to draw itself
-- ---------------------------------------------------------------------
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

-- Free start times for one day and one service.
create or replace function public.booking_slots(p_slug text, p_date date, p_procedure uuid)
returns table (slot timestamptz)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  c        public.clinics;
  v_mins   int;
  v_chairs int;
  v_used   int;
begin
  select * into c from public.clinics where booking_slug = lower(trim(p_slug)) and booking_enabled;
  if not found then raise exception 'BOOKING_UNAVAILABLE' using errcode = 'P0002'; end if;

  select p.default_duration_min into v_mins
  from public.procedures p
  where p.id = p_procedure and p.clinic_id = c.id and p.active and p.bookable_online;
  if v_mins is null then raise exception 'SERVICE_UNAVAILABLE'; end if;

  -- Outside the allowed window there is nothing to offer.
  if p_date < public.clinic_today(c.id)
     or p_date > public.clinic_today(c.id) + c.booking_horizon_days then
    return;
  end if;

  select count(*) into v_chairs from public.chairs where clinic_id = c.id;
  if v_chairs = 0 then return; end if;

  -- Daily cap: keeps room in the day for walk-ins and phone bookings.
  select count(*) into v_used
  from public.appointments a
  where a.clinic_id = c.id and a.source = 'online'
    and a.status not in ('cancelled', 'no_show')
    and (a.starts_at at time zone c.timezone)::date = p_date;
  if v_used >= c.booking_daily_limit then return; end if;

  return query
  with candidate as (
    -- Walk the day in slot-size steps, from opening to the last start that
    -- still fits the service before closing. Built as local wall-clock times,
    -- then anchored to the clinic's timezone.
    select (t at time zone c.timezone) as starts_at
    from generate_series(
           (p_date + c.opens_at)::timestamp,
           (p_date + c.closes_at)::timestamp - (v_mins || ' minutes')::interval,
           (c.slot_minutes || ' minutes')::interval) as t
  )
  select s.starts_at
  from candidate s
  where s.starts_at >= now() + (c.booking_min_notice_hours || ' hours')::interval
    and (
      select count(*) from public.appointments a
      where a.clinic_id = c.id
        and a.status not in ('cancelled', 'no_show')
        and tstzrange(a.starts_at, a.ends_at, '[)')
            && tstzrange(s.starts_at, s.starts_at + (v_mins || ' minutes')::interval, '[)')
    ) < v_chairs
  order by s.starts_at;
end;
$$;

-- ---------------------------------------------------------------------
-- The booking itself
-- ---------------------------------------------------------------------
create or replace function public.book_appointment(
  p_slug      text,
  p_procedure uuid,
  p_start     timestamptz,
  p_name      text,
  p_phone     text,
  p_note      text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  c          public.clinics;
  v_mins     int;
  v_name     text := trim(p_name);
  v_phone    text := regexp_replace(coalesce(p_phone, ''), '\s|-', '', 'g');
  v_patient  uuid;
  v_chair    uuid;
  v_end      timestamptz;
  v_date     date;
  v_id       uuid;
begin
  select * into c from public.clinics where booking_slug = lower(trim(p_slug)) and booking_enabled;
  if not found then raise exception 'BOOKING_UNAVAILABLE' using errcode = 'P0002'; end if;

  if length(v_name) < 3 then raise exception 'NAME_REQUIRED'; end if;
  if v_phone !~ '^(01[0-9]{9}|\+?[0-9]{8,15})$' then raise exception 'PHONE_INVALID'; end if;

  select p.default_duration_min into v_mins
  from public.procedures p
  where p.id = p_procedure and p.clinic_id = c.id and p.active and p.bookable_online;
  if v_mins is null then raise exception 'SERVICE_UNAVAILABLE'; end if;

  v_end  := p_start + (v_mins || ' minutes')::interval;
  v_date := (p_start at time zone c.timezone)::date;

  -- Same rules as the slot list, re-checked here: the browser is not trusted.
  if p_start < now() + (c.booking_min_notice_hours || ' hours')::interval then
    raise exception 'TOO_SOON';
  end if;
  if v_date > public.clinic_today(c.id) + c.booking_horizon_days then
    raise exception 'TOO_FAR';
  end if;
  if (p_start at time zone c.timezone)::time < c.opens_at
     or (v_end at time zone c.timezone)::time > c.closes_at then
    raise exception 'OUTSIDE_HOURS';
  end if;

  if (select count(*) from public.appointments a
      where a.clinic_id = c.id and a.source = 'online'
        and a.status not in ('cancelled', 'no_show')
        and (a.starts_at at time zone c.timezone)::date = v_date) >= c.booking_daily_limit then
    raise exception 'DAY_FULL';
  end if;

  -- One person can't tie up the calendar with unconfirmed bookings.
  if (select count(*) from public.appointments a
      join public.patients pt on pt.id = a.patient_id
      where a.clinic_id = c.id and a.source = 'online' and a.confirmed_at is null
        and a.status not in ('cancelled', 'no_show') and a.starts_at > now()
        and pt.phone = v_phone) >= 2 then
    raise exception 'TOO_MANY_PENDING';
  end if;

  -- Existing patient by phone, otherwise a new file marked as an online booking.
  select id into v_patient from public.patients
  where clinic_id = c.id and phone = v_phone order by created_at limit 1;

  if v_patient is null then
    insert into public.patients (clinic_id, full_name, phone, source)
    values (c.id, v_name, v_phone, 'other')
    returning id into v_patient;
  end if;

  -- First chair with no overlapping appointment.
  select ch.id into v_chair
  from public.chairs ch
  where ch.clinic_id = c.id
    and not exists (
      select 1 from public.appointments a
      where a.chair_id = ch.id
        and a.status not in ('cancelled', 'no_show')
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_start, v_end, '[)')
    )
  order by ch.name
  limit 1;
  if v_chair is null then raise exception 'SLOT_TAKEN'; end if;

  insert into public.appointments
    (clinic_id, patient_id, chair_id, procedure_id, starts_at, ends_at, status, source, booked_name, notes)
  values
    (c.id, v_patient, v_chair, p_procedure, p_start, v_end, 'booked', 'online', v_name, nullif(trim(p_note), ''))
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'starts_at', p_start,
    'clinic', c.name,
    'minutes', v_mins
  );
exception
  when exclusion_violation then
    -- Two people picked the same slot at the same moment.
    raise exception 'SLOT_TAKEN';
end;
$$;

-- Reception confirms after calling the patient.
create or replace function public.confirm_booking(p_appointment uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_clinic uuid;
begin
  select clinic_id into v_clinic from public.appointments where id = p_appointment;
  if not found then raise exception 'Appointment not found'; end if;
  if not public.is_member(v_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.appointments set confirmed_at = now() where id = p_appointment and confirmed_at is null;
end;
$$;

-- Online bookings still waiting for a call (staff only).
create view public.pending_bookings with (security_invoker = true) as
select a.id, a.clinic_id, a.patient_id, a.starts_at, a.ends_at, a.booked_name, a.notes,
       p.full_name, p.phone, p.whatsapp_phone,
       pr.name as service_name,
       a.created_at
from public.appointments a
join public.patients p on p.id = a.patient_id
left join public.procedures pr on pr.id = a.procedure_id
where a.source = 'online' and a.confirmed_at is null
  and a.status not in ('cancelled', 'no_show')
  and a.starts_at > now()
order by a.starts_at;

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;
grant select on public.pending_bookings to authenticated;

grant execute on function public.confirm_booking(uuid) to authenticated;
grant execute on function
  public.booking_clinic(text),
  public.booking_slots(text, date, uuid),
  public.book_appointment(text, uuid, timestamptz, text, text, text)
to anon, authenticated;

-- Patient form links stay reachable for anonymous visitors.
grant execute on function public.get_form_by_token(text), public.submit_form(text, jsonb, text, text) to anon;
