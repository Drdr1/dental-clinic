-- =====================================================================
-- Dental Clinic System — migration 0016: delete a material
-- Requires: 0001–0015
--
-- Materials created by mistake need to go. Movements are append-only, so
-- deletion runs through here:
--   * no movements at all  → anyone on the team can delete it
--   * has movements        → owner only, and purchase EXPENSES are kept
--     (that money really left the clinic) and simply detached.
-- =====================================================================

create or replace function public.delete_material(p_material uuid, p_force boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic uuid;
  v_name   text;
  v_moves  int;
begin
  select clinic_id, name into v_clinic, v_name from public.materials where id = p_material;
  if not found then raise exception 'Material not found'; end if;
  if not public.is_member(v_clinic) then raise exception 'Not allowed' using errcode = '42501'; end if;

  select count(*) into v_moves from public.material_movements where material_id = p_material;

  if v_moves > 0 then
    if not p_force then raise exception 'HAS_MOVEMENTS: %', v_moves; end if;
    if not public.has_role(v_clinic, array['owner']::public.member_role[]) then
      raise exception 'Only the clinic owner can delete a material that has stock history'
        using errcode = '42501';
    end if;
  end if;

  perform set_config('app.purging_patient', 'on', true);   -- same transaction-local guard exemption

  -- Purchases were real spending: keep the expense, drop the link, and note the
  -- material's name so the line still makes sense later.
  update public.expenses e
  set material_movement_id = null,
      note = case when coalesce(e.note, '') ilike '%' || v_name || '%'
                  then e.note
                  else trim(both ' ' from coalesce(e.note, '') || ' (' || v_name || ')') end
  where e.material_movement_id in (select id from public.material_movements where material_id = p_material);

  delete from public.procedure_materials where material_id = p_material;
  delete from public.material_movements  where material_id = p_material;
  delete from public.materials           where id = p_material;

  perform set_config('app.purging_patient', 'off', true);
  return jsonb_build_object('deleted', true, 'movements', v_moves);
end;
$$;

grant execute on function public.delete_material(uuid, boolean) to authenticated;
