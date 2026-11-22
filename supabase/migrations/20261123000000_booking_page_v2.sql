-- Online booking page, v2 design: the page shows the clinic's address and
-- days off, each service's price (if the clinic allows), and the full day of
-- slots with the taken ones crossed out instead of hidden.

alter table public.clinics
  add column if not exists address             text check (address is null or length(address) <= 200),
  add column if not exists closed_weekdays     smallint[] not null default '{5}',  -- 0 = Sunday … 6 = Saturday; Friday off by default
  add column if not exists booking_show_prices boolean not null default true;

alter table public.clinics drop constraint if exists clinics_closed_weekdays_valid;
alter table public.clinics add constraint clinics_closed_weekdays_valid
  check (closed_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]);

grant update (address, closed_weekdays, booking_show_prices) on public.clinics to authenticated;

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
    'address', c.address,
    'timezone', c.timezone,
    'opens_at', c.opens_at,
    'closes_at', c.closes_at,
    'closed_weekdays', to_jsonb(c.closed_weekdays),
    'slot_minutes', c.slot_minutes,
    'min_notice_hours', c.booking_min_notice_hours,
    'horizon_days', c.booking_horizon_days,
    'today', public.clinic_today(c.id),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'minutes', p.default_duration_min,
               'price', case when c.booking_show_prices then p.default_price end)
             order by p.name)
      from public.procedures p
      where p.clinic_id = c.id and p.active and p.bookable_online
    ), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

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

  if extract(dow from p_date)::smallint = any(c.closed_weekdays) then return; end if;

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
  if extract(dow from v_date)::smallint = any(c.closed_weekdays) then
    raise exception 'CLINIC_CLOSED_DAY';
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

-- Every slot in the day with whether it can still be booked, so the page can
-- show taken times crossed out. Same rules as booking_slots.
create or replace function public.booking_day(p_slug text, p_date date, p_procedure uuid)
returns table (slot timestamptz, free boolean)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  c        public.clinics;
  v_mins   int;
  v_chairs int;
  v_full   boolean;
begin
  select * into c from public.clinics where booking_slug = lower(trim(p_slug)) and booking_enabled;
  if not found then raise exception 'BOOKING_UNAVAILABLE' using errcode = 'P0002'; end if;

  select p.default_duration_min into v_mins
  from public.procedures p
  where p.id = p_procedure and p.clinic_id = c.id and p.active and p.bookable_online;
  if v_mins is null then raise exception 'SERVICE_UNAVAILABLE'; end if;

  if p_date < public.clinic_today(c.id)
     or p_date > public.clinic_today(c.id) + c.booking_horizon_days
     or extract(dow from p_date)::smallint = any(c.closed_weekdays) then
    return;
  end if;

  select count(*) into v_chairs from public.chairs where clinic_id = c.id;
  if v_chairs = 0 then return; end if;

  select count(*) >= c.booking_daily_limit into v_full
  from public.appointments a
  where a.clinic_id = c.id and a.source = 'online'
    and a.status not in ('cancelled', 'no_show')
    and (a.starts_at at time zone c.timezone)::date = p_date;

  return query
  with candidate as (
    select (t at time zone c.timezone) as starts_at
    from generate_series(
           (p_date + c.opens_at)::timestamp,
           (p_date + c.closes_at)::timestamp - (v_mins || ' minutes')::interval,
           (c.slot_minutes || ' minutes')::interval) as t
  )
  select s.starts_at,
         not v_full
         and s.starts_at >= now() + (c.booking_min_notice_hours || ' hours')::interval
         and (
           select count(*) from public.appointments a
           where a.clinic_id = c.id
             and a.status not in ('cancelled', 'no_show')
             and tstzrange(a.starts_at, a.ends_at, '[)')
                 && tstzrange(s.starts_at, s.starts_at + (v_mins || ' minutes')::interval, '[)')
         ) < v_chairs
  from candidate s
  order by s.starts_at;
end;
$$;

revoke all on function public.booking_day(text, date, uuid) from public;
grant execute on function public.booking_day(text, date, uuid) to anon, authenticated;
