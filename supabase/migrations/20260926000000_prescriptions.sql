-- =====================================================================
-- Dental Clinic System — migration 0008: prescriptions
-- Requires: 0001–0007
--
--   * allergy_groups: shared reference list (penicillin, NSAIDs, …) with
--     Arabic/English keywords used to scan free-text medical alerts
--   * patients.allergy_groups: structured allergies per patient
--   * drugs: per-clinic catalog, each drug tagged with its allergy group
--   * prescription_templates: ready-made sets ("After extraction", …)
--   * prescriptions + items (snapshotted, never edited)
--   * create_prescription(): doctor-only; refuses a drug that conflicts with
--     the patient's allergies unless the doctor gives a written reason
--
-- Default doses below are common adult starting points for the catalog only.
-- The clinic's doctor must review and adjust them before real use.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Allergy groups (reference data, same for every clinic)
-- ---------------------------------------------------------------------
create table public.allergy_groups (
  code      text primary key,
  label_ar  text not null,
  label_en  text not null,
  keywords  text[] not null default '{}'      -- lower-case; matched inside medical_alerts
);

insert into public.allergy_groups (code, label_ar, label_en, keywords) values
  ('penicillin',     'بنسلين',                 'Penicillins',
     array['penicillin','بنسلين','بنسيلين','amoxicillin','اموكسيسيلين','أموكسيسيلين','augmentin','اوجمنتين','أوجمنتين','ampicillin','امبيسيلين','flucloxacillin','hibiotic','هاي بيوتك']),
  ('cephalosporin',  'سيفالوسبورين',           'Cephalosporins',
     array['cephalosporin','سيفالوسبورين','cephalexin','سيفالكسين','cefuroxime','zinnat','زينات','cefadroxil','ceftriaxone']),
  ('nsaid',          'مسكنات (NSAIDs/أسبرين)', 'NSAIDs / aspirin',
     array['nsaid','aspirin','اسبرين','أسبرين','ibuprofen','ايبوبروفين','brufen','بروفين','diclofenac','ديكلوفيناك','cataflam','كتافلام','كاتافلام','voltaren','فولتارين','ketoprofen','ketorolac','naproxen']),
  ('sulfa',          'سلفا',                    'Sulfonamides',
     array['sulfa','سلفا','sulfonamide','septrin','سبترين','bactrim','sulfamethoxazole']),
  ('macrolide',      'ماكرولايد',              'Macrolides',
     array['macrolide','erythromycin','اريثرومايسين','azithromycin','ازيثرومايسين','zithromax','clarithromycin','klacid']),
  ('lincosamide',    'كلينداميسين',            'Clindamycin',
     array['clindamycin','كلينداميسين','dalacin','دالاسين']),
  ('metronidazole',  'ميترونيدازول',           'Metronidazole',
     array['metronidazole','ميترونيدازول','flagyl','فلاجيل']),
  ('paracetamol',    'باراسيتامول',            'Paracetamol',
     array['paracetamol','باراسيتامول','panadol','بنادول','acetaminophen','cetal','سيتال']),
  ('opioid',         'كودايين/أفيونات',        'Codeine / opioids',
     array['codeine','كودايين','tramadol','ترامادول','opioid']),
  ('local_anesthetic','البنج الموضعي',          'Local anesthetics',
     array['lidocaine','ليدوكايين','articaine','mepivacaine','بنج موضعي','local anesthetic','local anaesthetic']),
  ('chlorhexidine',  'كلورهيكسيدين',           'Chlorhexidine',
     array['chlorhexidine','كلورهيكسيدين','hexitol','هيكسيتول']),
  ('latex',          'لاتكس',                  'Latex',
     array['latex','لاتكس']);

alter table public.allergy_groups enable row level security;
create policy allergy_groups_read on public.allergy_groups for select to authenticated using (true);

alter table public.patients
  add column allergy_groups text[] not null default '{}';

-- Keep patient allergy codes valid.
create or replace function public.check_patient_allergy_groups()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from unnest(new.allergy_groups) g where g not in (select code from public.allergy_groups)) then
    raise exception 'Unknown allergy group';
  end if;
  return new;
end;
$$;

create trigger patients_check_allergy_groups
  before insert or update of allergy_groups on public.patients
  for each row execute function public.check_patient_allergy_groups();

-- ---------------------------------------------------------------------
-- Drug catalog & templates
-- ---------------------------------------------------------------------
create table public.drugs (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  name              text not null,            -- as printed, e.g. "Augmentin 1g"
  generic_name      text,
  form              text,                     -- tablet, capsule, mouthwash, gel…
  allergy_group     text references public.allergy_groups(code),
  default_dose      text,
  default_frequency text,
  default_duration  text,
  default_notes     text,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (clinic_id, name),
  unique (id, clinic_id)
);

create table public.prescription_templates (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  name        text not null,
  items       jsonb not null default '[]',    -- [{drug_id, dose, frequency, duration, notes}]
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (clinic_id, name)
);

-- Default catalog + two templates for a clinic (called for existing clinics
-- below, and by the production bootstrap for new ones).
create or replace function public.seed_default_drugs(p_clinic uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ibu uuid; v_chx uuid; v_amx uuid; v_met uuid; v_par uuid;
begin
  insert into public.drugs (clinic_id, name, generic_name, form, allergy_group, default_dose, default_frequency, default_duration, default_notes) values
    (p_clinic, 'Amoxicillin 500mg',        'amoxicillin',             'capsule',   'penicillin',     '1 capsule', 'every 8 hours',  '5 days', 'بعد الأكل'),
    (p_clinic, 'Augmentin 1g',             'amoxicillin/clavulanate', 'tablet',    'penicillin',     '1 tablet',  'every 12 hours', '5 days', 'بعد الأكل'),
    (p_clinic, 'Clindamycin 300mg',        'clindamycin',             'capsule',   'lincosamide',    '1 capsule', 'every 8 hours',  '5 days', 'بديل لو فيه حساسية بنسلين'),
    (p_clinic, 'Azithromycin 500mg',       'azithromycin',            'tablet',    'macrolide',      '1 tablet',  'once daily',     '3 days', null),
    (p_clinic, 'Cephalexin 500mg',         'cephalexin',              'capsule',   'cephalosporin',  '1 capsule', 'every 6 hours',  '5 days', null),
    (p_clinic, 'Metronidazole 500mg',      'metronidazole',           'tablet',    'metronidazole',  '1 tablet',  'every 8 hours',  '5 days', 'ممنوع الكحوليات'),
    (p_clinic, 'Ibuprofen 400mg',          'ibuprofen',               'tablet',    'nsaid',          '1 tablet',  'every 8 hours',  '3 days', 'بعد الأكل، عند الألم'),
    (p_clinic, 'Diclofenac 50mg',          'diclofenac potassium',    'tablet',    'nsaid',          '1 tablet',  'every 12 hours', '3 days', 'بعد الأكل، عند الألم'),
    (p_clinic, 'Paracetamol 500mg',        'paracetamol',             'tablet',    'paracetamol',    '1–2 tablets','every 6 hours', '3 days', 'عند الألم، بحد أقصى 8 أقراص في اليوم'),
    (p_clinic, 'Chlorhexidine 0.12% mouthwash','chlorhexidine',       'mouthwash', 'chlorhexidine',  '15 ml',     'twice daily',    '7 days', 'مضمضة 30 ثانية ومايتبلعش، ابدأ تاني يوم')
  on conflict (clinic_id, name) do nothing;

  select id into v_ibu from public.drugs where clinic_id = p_clinic and name = 'Ibuprofen 400mg';
  select id into v_chx from public.drugs where clinic_id = p_clinic and name = 'Chlorhexidine 0.12% mouthwash';
  select id into v_amx from public.drugs where clinic_id = p_clinic and name = 'Amoxicillin 500mg';
  select id into v_met from public.drugs where clinic_id = p_clinic and name = 'Metronidazole 500mg';
  select id into v_par from public.drugs where clinic_id = p_clinic and name = 'Paracetamol 500mg';

  insert into public.prescription_templates (clinic_id, name, items) values
    (p_clinic, 'بعد الخلع', jsonb_build_array(
       jsonb_build_object('drug_id', v_ibu), jsonb_build_object('drug_id', v_chx))),
    (p_clinic, 'التهاب / خراج', jsonb_build_array(
       jsonb_build_object('drug_id', v_amx), jsonb_build_object('drug_id', v_met), jsonb_build_object('drug_id', v_par)))
  on conflict (clinic_id, name) do nothing;
end;
$$;

do $$
declare c uuid;
begin
  for c in select id from public.clinics loop perform public.seed_default_drugs(c); end loop;
end $$;

-- ---------------------------------------------------------------------
-- Prescriptions (snapshot of what was printed; never edited)
-- ---------------------------------------------------------------------
create table public.prescriptions (
  id                       uuid primary key default gen_random_uuid(),
  clinic_id                uuid not null references public.clinics(id),
  patient_id               uuid not null,
  treatment_plan_id        uuid,
  prescribed_by            uuid not null default auth.uid(),
  prescribed_at            timestamptz not null default now(),
  notes                    text,
  allergy_override_reason  text,
  unique (id, clinic_id),
  foreign key (patient_id, clinic_id)        references public.patients (id, clinic_id),
  foreign key (treatment_plan_id, clinic_id) references public.treatment_plans (id, clinic_id)
);
create index prescriptions_patient_idx on public.prescriptions (patient_id, prescribed_at desc);

create table public.prescription_items (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics(id),
  prescription_id  uuid not null,
  position         smallint not null,
  drug_id          uuid references public.drugs(id),
  drug_name        text not null,
  allergy_group    text,
  dose             text,
  frequency        text,
  duration         text,
  notes            text,
  foreign key (prescription_id, clinic_id) references public.prescriptions (id, clinic_id) on delete cascade
);

create trigger prescriptions_append_only before update or delete on public.prescriptions
  for each row execute function public.forbid_mutation();
create trigger prescription_items_append_only before update or delete on public.prescription_items
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------
-- Allergy check
-- ---------------------------------------------------------------------
-- For a patient and a set of drugs: which drugs conflict, and why.
--   source = 'listed'    : the group is in patients.allergy_groups
--   source = 'mentioned' : a keyword of the group appears in medical_alerts
create or replace function public.prescription_conflicts(p_patient uuid, p_drugs uuid[])
returns table (drug_id uuid, drug_name text, allergy_group text, label_ar text, label_en text, source text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select d.id, d.name, g.code, g.label_ar, g.label_en,
         case when g.code = any (p.allergy_groups) then 'listed' else 'mentioned' end
  from public.patients p
  join public.drugs d on d.id = any (p_drugs) and d.clinic_id = p.clinic_id
  join public.allergy_groups g on g.code = d.allergy_group
  where p.id = p_patient
    and public.is_member(p.clinic_id)
    and (
      g.code = any (p.allergy_groups)
      or exists (select 1 from unnest(g.keywords) k where position(k in lower(coalesce(p.medical_alerts, ''))) > 0)
    );
$$;

-- Doctor-only. p_items: [{drug_id, dose, frequency, duration, notes}] or
-- [{drug_name, ...}] for a drug that isn't in the catalog.
create or replace function public.create_prescription(
  p_patient_id       uuid,
  p_items            jsonb,
  p_notes            text default null,
  p_treatment_plan_id uuid default null,
  p_override_reason  text default null)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic     uuid;
  v_id         uuid;
  v_conflicts  text;
  v_drug_ids   uuid[];
  item         jsonb;
  n            int := 0;
  d            public.drugs;
begin
  select clinic_id into v_clinic from public.patients where id = p_patient_id;
  if not found then raise exception 'Patient not found'; end if;
  if not public.is_doctor(v_clinic) then
    raise exception 'Only a doctor can write prescriptions' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A prescription needs at least one drug';
  end if;

  select array_agg((x->>'drug_id')::uuid) into v_drug_ids
  from jsonb_array_elements(p_items) x where x ? 'drug_id' and x->>'drug_id' is not null;

  select string_agg(c.drug_name || ' (' || c.label_en || ')', ', ') into v_conflicts
  from public.prescription_conflicts(p_patient_id, coalesce(v_drug_ids, '{}')) c;

  if v_conflicts is not null and length(trim(coalesce(p_override_reason, ''))) = 0 then
    raise exception 'ALLERGY_CONFLICT: %', v_conflicts using errcode = 'P0001';
  end if;

  insert into public.prescriptions (clinic_id, patient_id, treatment_plan_id, notes, allergy_override_reason)
  values (v_clinic, p_patient_id, p_treatment_plan_id, nullif(trim(p_notes), ''),
          case when v_conflicts is not null then trim(p_override_reason) end)
  returning id into v_id;

  for item in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    d := null;
    if item->>'drug_id' is not null then
      select * into d from public.drugs where id = (item->>'drug_id')::uuid and clinic_id = v_clinic;
      if not found then raise exception 'Drug not found in this clinic''s catalog'; end if;
    elsif length(trim(coalesce(item->>'drug_name', ''))) = 0 then
      raise exception 'Each item needs a drug';
    end if;

    insert into public.prescription_items
      (clinic_id, prescription_id, position, drug_id, drug_name, allergy_group, dose, frequency, duration, notes)
    values
      (v_clinic, v_id, n, d.id, coalesce(d.name, trim(item->>'drug_name')), d.allergy_group,
       nullif(trim(item->>'dose'), ''), nullif(trim(item->>'frequency'), ''),
       nullif(trim(item->>'duration'), ''), nullif(trim(item->>'notes'), ''));
  end loop;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS & grants
-- ---------------------------------------------------------------------
alter table public.drugs                  enable row level security;
alter table public.prescription_templates enable row level security;
alter table public.prescriptions          enable row level security;
alter table public.prescription_items     enable row level security;

create policy drugs_select on public.drugs for select to authenticated using (public.is_member(clinic_id));
create policy drugs_write on public.drugs for all to authenticated
  using (public.is_doctor(clinic_id)) with check (public.is_doctor(clinic_id));

create policy rx_templates_select on public.prescription_templates for select to authenticated using (public.is_member(clinic_id));
create policy rx_templates_write on public.prescription_templates for all to authenticated
  using (public.is_doctor(clinic_id)) with check (public.is_doctor(clinic_id));

create policy prescriptions_select on public.prescriptions for select to authenticated using (public.is_member(clinic_id));
create policy prescription_items_select on public.prescription_items for select to authenticated using (public.is_member(clinic_id));

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;
revoke insert, update, delete on public.prescriptions, public.prescription_items, public.allergy_groups from authenticated;
revoke delete on public.drugs from authenticated;

revoke execute on function public.seed_default_drugs(uuid)          from authenticated;
revoke execute on function public.check_patient_allergy_groups()   from authenticated;
grant execute on function
  public.prescription_conflicts(uuid, uuid[]),
  public.create_prescription(uuid, jsonb, text, uuid, text)
to authenticated;

-- Keep the patient form RPCs reachable for anonymous links.
grant execute on function public.get_form_by_token(text), public.submit_form(text, jsonb, text, text) to anon;
