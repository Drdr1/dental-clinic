-- Procedures that take more than one visit (a crown, a root canal).
--
-- Each procedure says how many visits it usually takes; a plan item copies
-- that number when it is added and the doctor can change it on the plan.
-- A visit records "session 2 of 3" on an item; the item is done when its last
-- session is recorded, or earlier when the doctor says it is finished.

alter table public.procedures
  add column sessions_needed int not null default 1 check (sessions_needed between 1 and 20);

alter table public.treatment_plan_items
  add column sessions_needed int not null default 1 check (sessions_needed between 1 and 20);

-- One row per visit that worked on an item.
create table public.plan_item_steps (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  item_id     uuid not null references public.treatment_plan_items(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  step        int  not null check (step >= 1),
  created_at  timestamptz not null default now(),
  unique (item_id, step),
  unique (item_id, session_id)
);
create index plan_item_steps_session_idx on public.plan_item_steps (session_id);

alter table public.plan_item_steps enable row level security;
create policy plan_item_steps_select on public.plan_item_steps
  for select to authenticated using (public.is_member(clinic_id));
-- Written only by record_session.
revoke insert, update, delete on public.plan_item_steps from anon, authenticated;

-- A new item takes the procedure's number of sessions unless one was given.
create or replace function public.plan_item_default_sessions() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.procedure_id is not null and new.sessions_needed = 1 then
    select greatest(1, p.sessions_needed) into new.sessions_needed
    from public.procedures p where p.id = new.procedure_id;
    new.sessions_needed := coalesce(new.sessions_needed, 1);
  end if;
  return new;
end;
$$;
create trigger treatment_plan_items_default_sessions before insert on public.treatment_plan_items
  for each row execute function public.plan_item_default_sessions();

-- Work already started stays on the plan, like finished work.
create or replace function public.guard_started_item() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('app.purging_patient', true), '') = 'on' then return old; end if;
  if exists (select 1 from public.plan_item_steps s where s.item_id = old.id) then
    raise exception 'ITEM_DONE: work already carried out stays on the plan';
  end if;
  return old;
end;
$$;
create trigger treatment_plan_items_started before delete on public.treatment_plan_items
  for each row execute function public.guard_started_item();

-- record_session gains p_step_item_ids: items worked on in this visit. Each
-- gets its next session number; reaching its last session marks it done.
-- p_done_item_ids still means "finished in this visit", whatever the count.
drop function public.record_session(uuid, text, boolean, uuid, uuid[], text, uuid);

create function public.record_session(
  p_patient_id uuid, p_notes text, p_is_recall_visit boolean,
  p_treatment_plan_id uuid default null, p_done_item_ids uuid[] default '{}',
  p_override_reason text default null, p_doctor_id uuid default null,
  p_step_item_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clinic  uuid;
  v_id      uuid;
  v_doctor  uuid;
  v_status  text;
  v_items   uuid[] := array(select distinct x from unnest(coalesce(p_done_item_ids, '{}') || coalesce(p_step_item_ids, '{}')) x);
  v_item    record;
  v_step    int;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if not found then raise exception 'Patient not found'; end if;
  if not public.is_member(v_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;

  if p_treatment_plan_id is not null then
    select status::text into v_status from public.treatment_plans
    where id = p_treatment_plan_id and patient_id = p_patient_id;
    if not found then raise exception 'Treatment plan does not belong to this patient'; end if;
  end if;
  if cardinality(v_items) > 0 and p_treatment_plan_id is null then
    raise exception 'Items can only be marked done within a treatment plan';
  end if;
  if cardinality(v_items) > 0 then
    if v_status in ('declined', 'cancelled', 'completed') then
      raise exception 'Treatment plan is %', v_status;
    end if;
    -- Work done on a plan that was only proposed means it was accepted on the spot.
    if v_status in ('draft', 'presented') then
      update public.treatment_plans set status = 'active' where id = p_treatment_plan_id;
    end if;
  end if;

  -- Whose work this is: what the form says, else the caller if they are a
  -- doctor, else the patient's own doctor.
  v_doctor := p_doctor_id;
  if v_doctor is null then
    select m.user_id into v_doctor from public.clinic_members m
    where m.clinic_id = v_clinic and m.user_id = auth.uid() and m.role in ('owner', 'doctor');
  end if;
  if v_doctor is null then
    select p.primary_doctor_id into v_doctor from public.patients p where p.id = p_patient_id;
  end if;
  if v_doctor is not null and not exists (
    select 1 from public.clinic_members m
    where m.clinic_id = v_clinic and m.user_id = v_doctor and m.role in ('owner', 'doctor')
  ) then
    raise exception 'That doctor is not on this clinic''s team';
  end if;

  insert into public.sessions
    (clinic_id, patient_id, treatment_plan_id, doctor_id, notes, is_recall_visit, lock_override, override_reason)
  values
    (v_clinic, p_patient_id, p_treatment_plan_id, v_doctor, nullif(trim(p_notes), ''), coalesce(p_is_recall_visit, false),
     length(trim(coalesce(p_override_reason, ''))) > 0, nullif(trim(p_override_reason), ''))
  returning id into v_id;

  for v_item in
    select i.id, i.sessions_needed from public.treatment_plan_items i
    where i.id = any (v_items) and i.plan_id = p_treatment_plan_id and i.status = 'planned'
    for update
  loop
    select coalesce(max(s.step), 0) + 1 into v_step from public.plan_item_steps s where s.item_id = v_item.id;
    insert into public.plan_item_steps (clinic_id, item_id, session_id, step)
    values (v_clinic, v_item.id, v_id, v_step);
    if v_item.id = any (coalesce(p_done_item_ids, '{}')) or v_step >= v_item.sessions_needed then
      update public.treatment_plan_items set status = 'done', done_in_session_id = v_id where id = v_item.id;
    end if;
  end loop;
  if (select count(*) from public.plan_item_steps where session_id = v_id) <> cardinality(v_items) then
    raise exception 'Some items are no longer open on this plan; refresh and try again';
  end if;

  return v_id;
end;
$$;
revoke execute on function public.record_session(uuid, text, boolean, uuid, uuid[], text, uuid, uuid[]) from public, anon;
grant  execute on function public.record_session(uuid, text, boolean, uuid, uuid[], text, uuid, uuid[]) to authenticated;

-- Items finished before this change count as one session each, so numbering
-- and history stay whole.
insert into public.plan_item_steps (clinic_id, item_id, session_id, step)
select i.clinic_id, i.id, i.done_in_session_id, 1
from public.treatment_plan_items i
where i.status = 'done' and i.done_in_session_id is not null
on conflict do nothing;
