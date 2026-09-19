-- =====================================================================
-- Local development seed — runs automatically after `supabase db reset`.
-- NEVER run against production.
--
-- Logins (password for both: password123):
--   doctor@clinic.local      owner / doctor
--   reception@clinic.local   receptionist
-- =====================================================================

-- ---------- Auth users ----------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', ''
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid, 'doctor@clinic.local'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'reception@clinic.local')
) as u(id, email);

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

-- ---------- Clinic & team ----------
insert into public.clinics (id, name, grace_days, lock_threshold)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Demo Dental Clinic', 3, 2);

insert into public.clinic_members (clinic_id, user_id, role, display_name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner',        'Dr. Demo'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'receptionist', 'Reception');

-- ---------- Catalog (placeholder prices — replace with the real list) ----------
insert into public.chairs (clinic_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chair 1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Chair 2');

insert into public.procedures (clinic_id, name, default_price, default_duration_min) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Checkup',          300,   20),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Scaling & polish', 600,   30),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Composite filling',800,   45),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Extraction',       500,   30),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Root canal',       2500,  60),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Zirconia crown',   4000,  45),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Implant',          15000, 90),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Orthodontics',     25000, 30);

insert into public.labs (clinic_id, name, phone)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Demo Dental Lab', '01000000001');

insert into public.form_templates (clinic_id, kind, title, body) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'medical_history', 'Medical history',
   '{"questions":[
      {"id":"conditions","type":"multi","label_ar":"هل تعاني من أي من الآتي؟","label_en":"Do you have any of the following?",
       "options":["diabetes","hypertension","heart_disease","bleeding_disorder","none"]},
      {"id":"allergies","type":"text","label_ar":"هل عندك حساسية من أي أدوية؟","label_en":"Any drug allergies?"},
      {"id":"medications","type":"text","label_ar":"الأدوية اللي بتاخدها حاليًا","label_en":"Current medications"},
      {"id":"pregnant","type":"yesno","label_ar":"هل يوجد حمل حاليًا؟","label_en":"Currently pregnant?"}
   ]}'::jsonb),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'consent', 'General treatment consent',
   '{"text_ar":"أقر بأنه تم شرح خطة العلاج والبدائل والمخاطر المحتملة، وأوافق على بدء العلاج.",
     "text_en":"I confirm the treatment plan, alternatives and possible risks were explained, and I consent to treatment."}'::jsonb);

-- ---------- Patients ----------
insert into public.patients (id, clinic_id, full_name, phone, gender, medical_alerts, next_recall_due) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Mona Ali',     '01000000010', 'female', 'Penicillin allergy', current_date - 10),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Omar Hassan',  '01000000020', 'male',   null,                 current_date + 12),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sara Mahmoud', '01000000030', 'female', null,                 null);

-- ---------- A live installment plan (acts as the doctor) ----------
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

insert into public.treatment_plans (id, clinic_id, patient_id, title)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-0000-0000-0000-000000000001', 'Lower molar implants');

insert into public.treatment_plan_items (clinic_id, plan_id, procedure_id, tooth_number, price)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-000000000001', p.id, t.tooth, 10000
from public.procedures p, (values (36), (46)) as t(tooth)
where p.clinic_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and p.name = 'Implant';

-- 20,000 total, 5,000 down, 6 months starting 3 months ago -> a mix of paid, overdue and upcoming.
select public.create_installment_plan(
  'cccccccc-0000-0000-0000-000000000001', 5000, 6, (current_date - interval '3 months')::date);

select public.record_payment(ip.id, 5000, 'cash', 'Down payment')
from public.installment_plans ip where ip.treatment_plan_id = 'cccccccc-0000-0000-0000-000000000001';

select public.record_payment(ip.id, 2500, 'instapay', 'First installment')
from public.installment_plans ip where ip.treatment_plan_id = 'cccccccc-0000-0000-0000-000000000001';

-- A presented plan waiting for the patient's decision.
insert into public.treatment_plans (id, clinic_id, patient_id, title)
values ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-0000-0000-0000-000000000002', 'Crown on 26');

insert into public.treatment_plan_items (clinic_id, plan_id, procedure_id, tooth_number, price)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-000000000002', p.id, 26, 4000
from public.procedures p
where p.clinic_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and p.name = 'Zirconia crown';

update public.treatment_plans set status = 'presented' where id = 'cccccccc-0000-0000-0000-000000000002';

select set_config('request.jwt.claim.sub', '', false);
