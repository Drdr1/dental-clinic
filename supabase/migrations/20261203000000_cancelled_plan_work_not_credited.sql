-- Work on a cancelled plan is not credited to a doctor.
--
-- A plan is usually cancelled because it was opened by mistake or twice; the
-- patient's balance already drops it, but the doctor figures still counted its
-- finished items as work (and as the share of any money on the plan). Every
-- function that credits finished work now skips cancelled plans.
do $$
declare
  f record;
  def text;
  patched text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('doctor_earnings', 'collection_attribution', 'doctor_overview')
  loop
    def := pg_get_functiondef(f.oid);
    patched := regexp_replace(def,
      'join public\.sessions (\w+) on \1\.id = i\.done_in_session_id',
      'join public.sessions \1 on \1.id = i.done_in_session_id join public.treatment_plans tp_live on tp_live.id = i.plan_id and tp_live.status <> ''cancelled''',
      'g');
    if patched = def then
      raise exception 'cancelled-plan patch did not apply to %', f.oid::regprocedure;
    end if;
    execute patched;
  end loop;
end;
$$;
