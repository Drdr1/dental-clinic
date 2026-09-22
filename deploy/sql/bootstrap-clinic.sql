-- Production bootstrap: the real clinic, its owner, and the defaults the app needs.
-- Run once through server/03-create-owner.sh (it passes the psql variables).
-- Variables: :'owner_id'  :'owner_name'  :'clinic_name'
\set ON_ERROR_STOP on
begin;

-- Safe to re-run: the clinic is only created if it doesn't exist yet.
insert into public.clinics (name)
select :'clinic_name' where not exists (select 1 from public.clinics where name = :'clinic_name');

with c as (select id from public.clinics where name = :'clinic_name' order by created_at limit 1)
insert into public.clinic_members (clinic_id, user_id, role, display_name)
select c.id, :'owner_id'::uuid, 'owner', :'owner_name' from c
on conflict (clinic_id, user_id) do update set role = 'owner', active = true;

-- One chair to start with; add more from Settings.
with c as (select id from public.clinics where name = :'clinic_name' order by created_at limit 1)
insert into public.chairs (clinic_id, name) select c.id, 'كرسي 1' from c
on conflict do nothing;

-- Drug catalog + ready-made prescriptions (the doctor reviews doses in Settings).
select public.seed_default_drugs(id) from public.clinics where name = :'clinic_name';

-- Default forms (same as the demo seed; edit/replace later if needed).
with c as (select id from public.clinics where name = :'clinic_name' order by created_at limit 1)
insert into public.form_templates (clinic_id, kind, title, body)
select c.id, 'medical_history', 'التاريخ المرضي',
  '{"questions":[
     {"id":"conditions","type":"multi","label_ar":"هل تعاني من أي من الآتي؟","label_en":"Do you have any of the following?",
      "options":["diabetes","hypertension","heart_disease","bleeding_disorder","none"]},
     {"id":"allergies","type":"text","label_ar":"هل عندك حساسية من أي أدوية؟","label_en":"Any drug allergies?"},
     {"id":"medications","type":"text","label_ar":"الأدوية اللي بتاخدها حاليًا","label_en":"Current medications"},
     {"id":"pregnant","type":"yesno","label_ar":"هل يوجد حمل حاليًا؟","label_en":"Currently pregnant?"}
  ]}'::jsonb from c
union all
select c.id, 'consent', 'إقرار الموافقة على العلاج',
  '{"text_ar":"أقر بأنه تم شرح خطة العلاج والبدائل والمخاطر المحتملة، وأوافق على بدء العلاج.",
    "text_en":"I confirm the treatment plan, alternatives and possible risks were explained, and I consent to treatment."}'::jsonb from c
on conflict do nothing;

commit;

select c.name as clinic, m.display_name as owner, m.role
from public.clinics c join public.clinic_members m on m.clinic_id = c.id
where c.name = :'clinic_name';
