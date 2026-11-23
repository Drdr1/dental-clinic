-- =====================================================================
-- Reports page (owner only): one call returns every number on the page
-- for a date range, in the clinic's timezone.
--
--   new_patients / prev_new_patients, sources
--   plans funnel (presented → accepted / still thinking / declined) + reasons
--   appointments (done / cancelled / no-show, online)
--   chair occupancy on worked days, busiest hours, per-doctor table
-- =====================================================================

create or replace function public.clinic_report(p_clinic uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  c          public.clinics;
  v_days     int := p_to - p_from + 1;
  v_pfrom    date := p_from - (p_to - p_from + 1);
  v_pto      date := p_from - 1;
  v_open_min numeric;
  v_worked   int;
  r          jsonb := '{}'::jsonb;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see this report' using errcode = '42501';
  end if;
  if p_to < p_from or v_days > 400 then
    raise exception 'Bad date range' using errcode = '22023';
  end if;
  select * into c from public.clinics where id = p_clinic;
  v_open_min := extract(epoch from (c.closes_at - c.opens_at)) / 60;

  -- New patients and where they came from.
  r := r || jsonb_build_object(
    'new_patients', (select count(*) from public.patients p
      where p.clinic_id = p_clinic and (p.created_at at time zone c.timezone)::date between p_from and p_to),
    'prev_new_patients', (select count(*) from public.patients p
      where p.clinic_id = p_clinic and (p.created_at at time zone c.timezone)::date between v_pfrom and v_pto),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('source', s.source, 'patients', s.n, 'collected', s.collected)
                       order by s.n desc, s.collected desc)
      from (
        select case when p.source in ('facebook', 'instagram') then 'social' else coalesce(p.source, 'unknown') end as source,
               count(*) as n,
               coalesce(sum((select sum(x.amount) from public.payments x
                             where x.patient_id = p.id
                               and (x.received_at at time zone c.timezone)::date between p_from and p_to)), 0) as collected
        from public.patients p
        where p.clinic_id = p_clinic and (p.created_at at time zone c.timezone)::date between p_from and p_to
        group by 1
      ) s), '[]'::jsonb)
  );

  -- Treatment plans presented in the range, and what happened to them.
  r := r || (
    select jsonb_build_object('plans', jsonb_build_object(
      'presented',       count(*),
      'presented_value', coalesce(sum(v), 0),
      'accepted',        count(*) filter (where tp.accepted_at is not null),
      'accepted_value',  coalesce(sum(v) filter (where tp.accepted_at is not null), 0),
      'pending',         count(*) filter (where tp.status = 'presented'),
      'pending_value',   coalesce(sum(v) filter (where tp.status = 'presented'), 0),
      'declined',        count(*) filter (where tp.status = 'declined'),
      'declined_value',  coalesce(sum(v) filter (where tp.status = 'declined'), 0)
    ))
    from (select t.*, public.plan_net_total(t.id) as v from public.treatment_plans t
          where t.clinic_id = p_clinic and t.presented_at is not null
            and (t.presented_at at time zone c.timezone)::date between p_from and p_to) tp
  );
  r := r || jsonb_build_object('decline_reasons', coalesce((
    select jsonb_agg(jsonb_build_object('reason', x.reason, 'n', x.n) order by x.n desc)
    from (
      select min(trim(t.decline_reason)) as reason, count(*) as n
      from public.treatment_plans t
      where t.clinic_id = p_clinic and t.status = 'declined'
        and nullif(trim(t.decline_reason), '') is not null
        and (t.presented_at at time zone c.timezone)::date between p_from and p_to
      group by lower(trim(t.decline_reason))
      order by 2 desc limit 5
    ) x), '[]'::jsonb));

  -- Appointments in the range.
  r := r || (
    select jsonb_build_object('appointments', jsonb_build_object(
      'total',     count(*),
      'online',    count(*) filter (where a.source = 'online'),
      'done',      count(*) filter (where a.status = 'done'),
      'cancelled', count(*) filter (where a.status = 'cancelled'),
      'no_show',   count(*) filter (where a.status = 'no_show')
    ))
    from public.appointments a
    where a.clinic_id = p_clinic
      and (a.starts_at at time zone c.timezone)::date between p_from and p_to
      and (a.starts_at at time zone c.timezone)::date <= (now() at time zone c.timezone)::date
  );

  -- Chairs: booked minutes over open minutes, on the days the clinic worked.
  select count(distinct (a.starts_at at time zone c.timezone)::date) into v_worked
  from public.appointments a
  where a.clinic_id = p_clinic and a.status = 'done'
    and (a.starts_at at time zone c.timezone)::date between p_from and p_to;

  r := r || jsonb_build_object('worked_days', v_worked, 'chairs', coalesce((
    select jsonb_agg(jsonb_build_object('name', ch.name, 'pct',
             case when v_worked = 0 or v_open_min <= 0 then 0
                  else least(100, round(100 * coalesce(u.mins, 0) / (v_worked * v_open_min))) end)
           order by ch.name)
    from public.chairs ch
    left join lateral (
      select sum(extract(epoch from (a.ends_at - a.starts_at)) / 60) as mins
      from public.appointments a
      where a.chair_id = ch.id and a.status in ('done', 'arrived', 'in_session')
        and (a.starts_at at time zone c.timezone)::date between p_from and p_to
    ) u on true
    where ch.clinic_id = p_clinic and ch.active), '[]'::jsonb));

  -- Appointments per starting hour, across the open hours.
  r := r || jsonb_build_object('hours', (
    select jsonb_agg(jsonb_build_object('hour', h, 'n', coalesce(n, 0)) order by h)
    from generate_series(extract(hour from c.opens_at)::int,
                         greatest(extract(hour from c.opens_at)::int, extract(hour from c.closes_at - interval '1 minute')::int)) h
    left join (
      select extract(hour from a.starts_at at time zone c.timezone)::int as hr, count(*) as n
      from public.appointments a
      where a.clinic_id = p_clinic and a.status not in ('cancelled')
        and (a.starts_at at time zone c.timezone)::date between p_from and p_to
      group by 1
    ) x on x.hr = h));

  -- Per doctor: appointments done, no-shows, plan acceptance.
  r := r || jsonb_build_object('doctors', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', d.user_id, 'name', d.display_name,
             'done', d.done, 'no_show', d.no_show, 'presented', d.presented, 'accepted', d.accepted)
           order by d.done desc, d.display_name)
    from (
      select m.user_id, m.display_name,
        (select count(*) from public.appointments a where a.clinic_id = p_clinic and a.doctor_id = m.user_id
           and a.status = 'done' and (a.starts_at at time zone c.timezone)::date between p_from and p_to) as done,
        (select count(*) from public.appointments a where a.clinic_id = p_clinic and a.doctor_id = m.user_id
           and a.status = 'no_show' and (a.starts_at at time zone c.timezone)::date between p_from and p_to) as no_show,
        (select count(*) from public.treatment_plans t join public.patients p on p.id = t.patient_id
           where t.clinic_id = p_clinic and coalesce(p.primary_doctor_id, t.created_by) = m.user_id
             and t.presented_at is not null
             and (t.presented_at at time zone c.timezone)::date between p_from and p_to) as presented,
        (select count(*) from public.treatment_plans t join public.patients p on p.id = t.patient_id
           where t.clinic_id = p_clinic and coalesce(p.primary_doctor_id, t.created_by) = m.user_id
             and t.accepted_at is not null and t.presented_at is not null
             and (t.presented_at at time zone c.timezone)::date between p_from and p_to) as accepted
      from public.clinic_members m
      where m.clinic_id = p_clinic and m.role in ('owner', 'doctor')
    ) d
    where d.done > 0 or d.no_show > 0 or d.presented > 0), '[]'::jsonb));

  return r;
end;
$$;

revoke all on function public.clinic_report(uuid, date, date) from public, anon;
grant execute on function public.clinic_report(uuid, date, date) to authenticated;
