-- =====================================================================
-- Dental Clinic System — migration 0047: a record of what was asked
-- Requires: 0001–0046
--
-- The assistant answers questions about live patient data, so every
-- question and the tools it ran are written down. Two reasons: the owner
-- can see what the clinic is asking a model on the other side of a
-- network, and when an answer turns out to be wrong there is something
-- to look at besides memory.
--
-- The log holds the question and the tool names — never the rows that
-- came back, because those are the patient records themselves and they
-- are already in the tables they came from.
-- =====================================================================

create table if not exists public.assistant_queries (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  asked_by    uuid not null default auth.uid(),
  question    text not null,
  tools_used  text[] not null default '{}',
  answered    boolean not null default false,
  error       text,
  asked_at    timestamptz not null default now()
);

create index if not exists assistant_queries_recent
  on public.assistant_queries (clinic_id, asked_at desc);

alter table public.assistant_queries enable row level security;

-- Anyone in the clinic may add to the log; only the owner reads it back,
-- because a question can give away what someone was looking into.
drop policy if exists assistant_queries_insert on public.assistant_queries;
create policy assistant_queries_insert on public.assistant_queries
  for insert to authenticated
  with check (public.is_member(clinic_id) and asked_by = auth.uid());

drop policy if exists assistant_queries_select on public.assistant_queries;
create policy assistant_queries_select on public.assistant_queries
  for select to authenticated
  using (public.has_role(clinic_id, array['owner']::public.member_role[]));

-- Append-only: a log somebody can tidy up is not a log.
drop trigger if exists assistant_queries_append_only on public.assistant_queries;
create trigger assistant_queries_append_only
  before update or delete on public.assistant_queries
  for each row execute function public.forbid_mutation();

grant select, insert on public.assistant_queries to authenticated;

-- Written by the edge function after it answers, under the asker's own
-- token so the policy above decides.
create or replace function public.log_assistant_query(
  p_clinic uuid, p_question text, p_tools text[], p_answered boolean, p_error text default null)
returns void
language sql security invoker
set search_path = public, pg_temp
as $$
  insert into public.assistant_queries (clinic_id, question, tools_used, answered, error)
  values (p_clinic, left(p_question, 2000), coalesce(p_tools, '{}'), p_answered, left(p_error, 500));
$$;

grant execute on function public.log_assistant_query(uuid, text, text[], boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Two reads the assistant needs that no screen happened to need
-- ---------------------------------------------------------------------
-- Both are security INVOKER: they run as whoever asked, so row-level
-- security decides what comes back. That is the whole safety story —
-- the assistant has no privileges of its own.

create or replace function public.assistant_patient_brief(p_clinic uuid, p_query text)
returns table (
  patient_id    uuid,
  full_name     text,
  phone         text,
  doctor_name   text,
  outstanding   numeric,
  overdue_count int,
  next_visit    timestamptz
)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select p.id, p.full_name, p.phone, m.display_name,
         coalesce(b.outstanding, 0), coalesce(b.overdue_count, 0),
         (select min(a.starts_at) from public.appointments a
          where a.patient_id = p.id and a.status = 'booked' and a.starts_at > now())
  from public.patients p
  left join public.clinic_members m
    on m.clinic_id = p.clinic_id and m.user_id = p.primary_doctor_id
  left join public.patient_balance b on b.patient_id = p.id
  where p.clinic_id = p_clinic
    and p.archived_at is null
    and (p.full_name ilike '%' || p_query || '%' or p.phone ilike '%' || p_query || '%')
  order by p.full_name
  limit 10;
$$;

create or replace function public.assistant_day_schedule(p_clinic uuid, p_date date)
returns table (
  starts_at   timestamptz,
  ends_at     timestamptz,
  full_name   text,
  phone       text,
  chair       text,
  doctor_name text,
  status      text,
  notes       text
)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select a.starts_at, a.ends_at, p.full_name, p.phone, ch.name, m.display_name,
         a.status::text, a.notes
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  join public.clinics c  on c.id = a.clinic_id
  left join public.chairs ch on ch.id = a.chair_id
  left join public.clinic_members m
    on m.clinic_id = a.clinic_id and m.user_id = a.doctor_id
  where a.clinic_id = p_clinic
    and (a.starts_at at time zone c.timezone)::date = p_date
    and a.status <> 'cancelled'
  order by a.starts_at;
$$;

grant execute on function public.assistant_patient_brief(uuid, text) to authenticated;
grant execute on function public.assistant_day_schedule(uuid, date) to authenticated;
