-- An online booking that ends up cancelled puts away the file it created when
-- that file has nothing else in it, whether or not reception had confirmed it
-- first. Booking again with the same phone brings the file back.
create or replace function public.tidy_rejected_booking() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and old.source = 'online' then
    update public.patients p
    set archived_at = now(), archive_reason = 'online_request_rejected'
    where p.id = new.patient_id
      and p.archived_at is null
      and p.source = 'other'
      and p.created_at >= old.created_at - interval '1 minute'
      and not exists (select 1 from public.appointments a
                      where a.patient_id = p.id and a.id <> new.id and a.status <> 'cancelled')
      and not exists (select 1 from public.treatment_plans where patient_id = p.id)
      and not exists (select 1 from public.sessions where patient_id = p.id)
      and not exists (select 1 from public.payments where patient_id = p.id)
      and not exists (select 1 from public.patient_files where patient_id = p.id);
  end if;
  return null;
end;
$$;
