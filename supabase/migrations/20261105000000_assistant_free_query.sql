-- =====================================================================
-- Dental Clinic System — migration 0048: let the assistant ask anything
-- Requires: 0001–0047
--
-- Eight fixed tools answer eight kinds of question. The clinic wants it to
-- answer any question about the clinic, so the assistant may now write its
-- own SELECT. Three walls keep that safe, and none of them is a promise
-- made in a prompt:
--
--  1. It runs as the person asking (security invoker). Every table has
--     row-level security and every view is security_invoker, so a query
--     sees exactly what that person's own token could fetch from the API —
--     not a row more. Reception asking for doctor earnings is refused by
--     the same policies that refuse the screens.
--  2. It cannot change anything. The transaction is switched to read-only
--     before the query runs, and Postgres never lets a transaction go back
--     to read-write. That holds for anything the query calls, including
--     the clinic's own write functions — an instruction hidden in a patient
--     note cannot make the model cancel a plan or record money.
--  3. It is one SELECT, wrapped as a subquery, capped at 200 rows.
--     Postgres refuses data-modifying statements inside a subquery anyway.
--
-- Which person runs it, and so what comes back, is decided by the token
-- PostgREST verified — the edge function has no privileges of its own.
-- =====================================================================

create or replace function public.assistant_query(p_sql text)
returns jsonb
language plpgsql volatile security invoker
set search_path = public, pg_temp
as $$
declare
  v_sql  text := btrim(p_sql);
  v_rows jsonb;
begin
  -- From here to the end of the transaction nothing can be written.
  -- (Read-only can be switched on at any point; it can never be switched off.)
  perform set_config('transaction_read_only', 'on', true);
  if current_setting('transaction_read_only') <> 'on' then
    raise exception 'could not make the query read-only';
  end if;

  v_sql := regexp_replace(v_sql, ';\s*$', '');
  if v_sql !~* '^(select|with)\s' then
    raise exception 'Only a single SELECT is allowed';
  end if;
  if position(';' in v_sql) > 0 then
    raise exception 'Only one statement is allowed';
  end if;
  if length(v_sql) > 8000 then
    raise exception 'Query too long';
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (select * from (%s) as inner_q limit 200) as q',
    v_sql)
  into v_rows;
  return v_rows;
end;
$$;

revoke all on function public.assistant_query(text) from public;
grant execute on function public.assistant_query(text) to authenticated;

-- What the assistant may query: every table and view in the clinic's schema
-- this person can read, with its columns. Read fresh on each question so a
-- new column is known the day it ships.
create or replace function public.assistant_schema()
returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(t.relname, t.cols order by t.relname), '{}'::jsonb)
  from (
    select c.relname,
           string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum) as cols
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r', 'v', 'm')
      and c.relname <> 'assistant_queries'
      and has_table_privilege(c.oid, 'select')
    group by c.relname
  ) t;
$$;

grant execute on function public.assistant_schema() to authenticated;

-- Every name and number this person can see, so the edge function can strip
-- them out of free-query results whatever the column is called. One jsonb
-- value rather than rows, so the API's row cap never cuts the list short —
-- a name missing from it would be a name that leaks.
create or replace function public.assistant_identities(p_clinic uuid)
returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'patients', coalesce((
      select jsonb_agg(jsonb_build_array(full_name, phone, whatsapp_phone, national_id, address))
      from public.patients where clinic_id = p_clinic), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_array(display_name, phone, registration_no))
      from public.clinic_members where clinic_id = p_clinic), '[]'::jsonb),
    'others', coalesce((
      select jsonb_agg(jsonb_build_array(name, phone))
      from public.payers where clinic_id = p_clinic), '[]'::jsonb)
  );
$$;

grant execute on function public.assistant_identities(uuid) to authenticated;
