-- =====================================================================
-- Post-visit review.
--
-- After a visit, reception sends the patient a one-time link on WhatsApp.
-- The patient rates 1–5 and can leave a comment; the rating reaches the
-- clinic. EVERY patient is then offered the clinic's Google review page —
-- Google does not allow asking only the happy ones (no "review gating").
-- Ratings of 3 or less are flagged for follow-up to the owner and the
-- visit's doctor until someone marks them handled.
-- =====================================================================

alter table public.clinics
  add column reviews_enabled boolean not null default false,
  add column google_review_url text check (google_review_url is null or (length(google_review_url) <= 300 and google_review_url ~* '^https://'));
grant update (reviews_enabled, google_review_url) on public.clinics to authenticated;

create table public.review_requests (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references public.clinics(id) on delete cascade,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  patient_id     uuid not null,
  doctor_id      uuid,
  token          text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '7 days',
  rating         smallint check (rating between 1 and 5),
  comment        text check (comment is null or length(comment) <= 1000),
  answered_at    timestamptz,
  went_to_google boolean not null default false,
  resolved_at    timestamptz,
  resolved_by    uuid,
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id) on delete cascade
);
create index review_requests_clinic_idx on public.review_requests (clinic_id, created_at desc);
create index review_requests_followup_idx on public.review_requests (clinic_id)
  where rating <= 3 and resolved_at is null;

alter table public.review_requests enable row level security;
create policy review_requests_select on public.review_requests for select to authenticated
  using (public.is_member(clinic_id));
revoke all on public.review_requests from anon, authenticated;
grant select on public.review_requests to authenticated;

-- Reception/doctor/owner: get (or make) the link for a finished visit.
create or replace function public.request_review(p_appointment uuid)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare a public.appointments; v_token text;
begin
  select * into a from public.appointments where id = p_appointment;
  if a.id is null or not public.is_member(a.clinic_id) then
    raise exception 'Appointment not found' using errcode = '42501';
  end if;
  if not (select reviews_enabled from public.clinics where id = a.clinic_id) then
    raise exception 'REVIEWS_OFF';
  end if;
  if a.status <> 'done' then raise exception 'VISIT_NOT_DONE'; end if;
  insert into public.review_requests (clinic_id, appointment_id, patient_id, doctor_id)
  values (a.clinic_id, a.id, a.patient_id, a.doctor_id)
  on conflict (appointment_id) do update set appointment_id = excluded.appointment_id
  returning token into v_token;
  return v_token;
end;
$$;

-- Owner or the visit's doctor: the follow-up is done.
create or replace function public.resolve_review(p_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare r public.review_requests;
begin
  select * into r from public.review_requests where id = p_id;
  if r.id is null or not (public.has_role(r.clinic_id, array['owner']::public.member_role[]) or r.doctor_id = auth.uid()) then
    raise exception 'Only the owner or the visit''s doctor can do this' using errcode = '42501';
  end if;
  update public.review_requests set resolved_at = now(), resolved_by = auth.uid()
  where id = p_id and resolved_at is null;
end;
$$;

-- Public (the patient, no login): what the review page shows.
create or replace function public.get_review(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare r public.review_requests; c public.clinics;
begin
  select * into r from public.review_requests where token = p_token;
  if r.id is null then return null; end if;
  select * into c from public.clinics where id = r.clinic_id;
  return jsonb_build_object(
    'clinic', c.name,
    'logo_url', c.logo_url,
    'patient', split_part(trim((select full_name from public.patients where id = r.patient_id)), ' ', 1),
    'doctor', (select display_name from public.clinic_members where clinic_id = r.clinic_id and user_id = r.doctor_id),
    'expired', r.answered_at is null and r.expires_at < now(),
    'rating', r.rating,
    'google_url', case when r.answered_at is not null then c.google_review_url end,
    'whatsapp', case when r.answered_at is not null then
      (select m.phone from public.clinic_members m where m.clinic_id = r.clinic_id and m.role = 'owner' and m.phone is not null order by m.created_at limit 1) end);
end;
$$;

-- Public: send the rating once.
create or replace function public.submit_review(p_token text, p_rating int, p_comment text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare r public.review_requests;
begin
  select * into r from public.review_requests where token = p_token for update;
  if r.id is null then raise exception 'REVIEW_NOT_FOUND'; end if;
  if r.answered_at is not null then raise exception 'REVIEW_DONE'; end if;
  if r.expires_at < now() then raise exception 'REVIEW_EXPIRED'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Bad rating' using errcode = '22023'; end if;
  update public.review_requests
  set rating = p_rating, comment = nullif(left(trim(coalesce(p_comment, '')), 1000), ''), answered_at = now()
  where id = r.id;
  return public.get_review(p_token);
end;
$$;

-- Public: the patient opened the Google page.
create or replace function public.review_to_google(p_token text)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  update public.review_requests set went_to_google = true where token = p_token and answered_at is not null;
$$;

revoke all on function public.request_review(uuid), public.resolve_review(uuid),
  public.get_review(text), public.submit_review(text, int, text), public.review_to_google(text) from public;
grant execute on function public.request_review(uuid), public.resolve_review(uuid) to authenticated;
grant execute on function public.get_review(text), public.submit_review(text, int, text), public.review_to_google(text) to anon, authenticated;

-- Reports: add the reviews numbers and each doctor's rating.
create or replace function public.clinic_report_reviews(p_clinic uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_tz text;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see this report' using errcode = '42501';
  end if;
  select timezone into v_tz from public.clinics where id = p_clinic;
  return (
    with rr as (
      select r.*, p.full_name, p.phone from public.review_requests r join public.patients p on p.id = r.patient_id
      where r.clinic_id = p_clinic and (r.created_at at time zone v_tz)::date between p_from and p_to
    )
    select jsonb_build_object(
      'avg', (select round(avg(rating)::numeric, 1) from rr where rating is not null),
      'count', (select count(*) from rr where rating is not null),
      'requested', (select count(*) from rr),
      'google', (select count(*) from rr where went_to_google),
      'dist', jsonb_build_object(
        '5', (select count(*) from rr where rating = 5), '4', (select count(*) from rr where rating = 4),
        '3', (select count(*) from rr where rating = 3), '2', (select count(*) from rr where rating = 2),
        '1', (select count(*) from rr where rating = 1)),
      'follow_up', (select count(*) from public.review_requests where clinic_id = p_clinic and rating <= 3 and resolved_at is null),
      'low', coalesce((
        select jsonb_agg(x order by x->>'at' desc) from (
          select jsonb_build_object('id', r.id, 'patient', p.full_name, 'phone', p.phone, 'stars', r.rating, 'comment', r.comment,
                   'doctor', (select display_name from public.clinic_members m where m.clinic_id = r.clinic_id and m.user_id = r.doctor_id),
                   'at', r.answered_at) as x
          from public.review_requests r join public.patients p on p.id = r.patient_id
          where r.clinic_id = p_clinic and r.rating <= 3 and r.resolved_at is null
          order by r.answered_at desc limit 10) l), '[]'::jsonb),
      'by_doctor', coalesce((
        select jsonb_object_agg(d.doctor_id, d.avg) from (
          select doctor_id, round(avg(rating)::numeric, 1) as avg from rr
          where rating is not null and doctor_id is not null group by doctor_id) d), '{}'::jsonb)
    ));
end;
$$;
revoke all on function public.clinic_report_reviews(uuid, date, date) from public, anon;
grant execute on function public.clinic_report_reviews(uuid, date, date) to authenticated;
