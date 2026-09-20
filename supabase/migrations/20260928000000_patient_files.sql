-- =====================================================================
-- Dental Clinic System — migration 0010: patient images & documents
-- Requires: 0001–0009
--
-- Creates the private `patient-files` bucket and its access rules.
-- Files live under {clinic_id}/{patient_id}/... so the clinic check is
-- simply the first folder of the path.
--
-- The whole block is skipped when the `storage` schema isn't present
-- (plain PostgreSQL), so the migration also runs outside Supabase.
-- =====================================================================

alter table public.patient_files
  add column caption_updated_at timestamptz,
  add column size_bytes         bigint,
  add column mime_type          text;

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not found — skipping bucket setup';
    return;
  end if;

  -- Private bucket: nothing is readable without a signed URL from the app.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('patient-files', 'patient-files', false, 20971520,
          array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Members of the clinic named in the first folder can read and upload;
  -- only the owner can delete.
  execute $p$
    create policy patient_files_read on storage.objects for select to authenticated
    using (bucket_id = 'patient-files'
           and public.is_member(nullif((storage.foldername(name))[1], '')::uuid))
  $p$;
  execute $p$
    create policy patient_files_upload on storage.objects for insert to authenticated
    with check (bucket_id = 'patient-files'
                and public.is_member(nullif((storage.foldername(name))[1], '')::uuid))
  $p$;
  execute $p$
    create policy patient_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'patient-files'
           and public.has_role(nullif((storage.foldername(name))[1], '')::uuid,
                               array['owner']::public.member_role[]))
  $p$;
exception
  when duplicate_object then
    raise notice 'storage policies already exist — leaving them as they are';
end $$;
