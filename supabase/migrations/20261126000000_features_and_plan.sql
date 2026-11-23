-- =====================================================================
-- Settings v2:
--   * disabled_features: the owner switches off parts the clinic does not
--     use. The screens hide them; the data already recorded is kept.
--     (Online booking keeps its own switch, clinics.booking_enabled.)
--   * the clinic's subscription, shown on the settings page. Written by
--     DerOps only (no update grant), read through subscription_status().
-- =====================================================================

alter table public.clinics
  add column disabled_features text[] not null default '{}'
    check (disabled_features <@ array['installments', 'labs', 'commission', 'materials', 'assistant', 'payers']::text[]),
  add column plan_name text not null default 'full',
  add column plan_price numeric(10,2),
  add column plan_renews_on date,
  add column assistant_monthly_limit int not null default 300 check (assistant_monthly_limit >= 0);

grant update (disabled_features) on public.clinics to authenticated;

create or replace function public.subscription_status(p_clinic uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare c public.clinics; v_from timestamptz;
begin
  if not public.has_role(p_clinic, array['owner']::public.member_role[]) then
    raise exception 'Only the clinic owner can see this' using errcode = '42501';
  end if;
  select * into c from public.clinics where id = p_clinic;
  v_from := date_trunc('month', now() at time zone c.timezone) at time zone c.timezone;
  return jsonb_build_object(
    'plan', c.plan_name,
    'price', c.plan_price,
    'renews_on', c.plan_renews_on,
    'chairs', (select count(*) from public.chairs where clinic_id = p_clinic and active),
    'users', (select count(*) from public.clinic_members where clinic_id = p_clinic and active),
    'assistant_used', (select count(*) from public.assistant_queries where clinic_id = p_clinic and asked_at >= v_from),
    'assistant_limit', c.assistant_monthly_limit);
end;
$$;
revoke all on function public.subscription_status(uuid) from public, anon;
grant execute on function public.subscription_status(uuid) to authenticated;

-- Switching a part on or off is a team/settings change worth a line in the log.
create or replace function public.audit_clinic_features() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare f text;
begin
  for f in select unnest(new.disabled_features) except select unnest(old.disabled_features) loop
    perform public._audit(new.id, 'team', 'feature.off', false, null, jsonb_build_object('feature', f));
  end loop;
  for f in select unnest(old.disabled_features) except select unnest(new.disabled_features) loop
    perform public._audit(new.id, 'team', 'feature.on', false, null, jsonb_build_object('feature', f));
  end loop;
  if new.booking_enabled is distinct from old.booking_enabled then
    perform public._audit(new.id, 'team', case when new.booking_enabled then 'feature.on' else 'feature.off' end, false, null,
      jsonb_build_object('feature', 'booking'));
  end if;
  return null;
end;
$$;
create trigger audit_clinic_features after update of disabled_features, booking_enabled on public.clinics
  for each row execute function public.audit_clinic_features();
