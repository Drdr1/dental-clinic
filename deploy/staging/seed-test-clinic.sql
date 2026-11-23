-- =====================================================================
-- TEST SERVER ONLY. A made-up clinic with made-up patients, so every page
-- of the app has something to show. Never run this on the live server:
-- it refuses if any clinic already exists.
--
--   psql -v pw='<password for the three test logins>' -f seed-test-clinic.sql
--
-- Logins (all three share the password you pass):
--   owner@test.dentano.app       صاحب العيادة (and a doctor)
--   doctor@test.dentano.app      دكتورة
--   reception@test.dentano.app   استقبال
-- =====================================================================
\set ON_ERROR_STOP on
begin;

do $$ begin
  if exists (select 1 from public.clinics) then
    raise exception 'This database already has a clinic. The test seed only runs on an empty test server.';
  end if;
end $$;

-- ---------- Logins ----------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt(:'pw', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('7e570000-0000-4000-8000-000000000001'::uuid, 'owner@test.dentano.app'),
  ('7e570000-0000-4000-8000-000000000002'::uuid, 'doctor@test.dentano.app'),
  ('7e570000-0000-4000-8000-000000000003'::uuid, 'reception@test.dentano.app')
) u(id, email);

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u where u.email like '%@test.dentano.app';

commit;

-- ---------- Everything else, in one go ----------
do $$
declare
  c        uuid := '7e570000-0000-4000-8000-0000000000c1';
  owner    uuid := '7e570000-0000-4000-8000-000000000001';
  doc      uuid := '7e570000-0000-4000-8000-000000000002';
  rec      uuid := '7e570000-0000-4000-8000-000000000003';
  tz       text := 'Africa/Cairo';
  today    date := (now() at time zone 'Africa/Cairo')::date;
  ch       uuid[];
  pr       record;
  p        record;
  i        int;
  d        date;
  slot     int;
  st       public.appointment_status;
  appt     uuid;
  plan     uuid;
  items    uuid[];
  sess     uuid;
  inst     uuid;
  mat      uuid;
  lab      uuid;
  names    text[] := array[
    'منى علي حسن','كريم فتحي','هبة سمير','يوسف طارق','مريم حسن','عمر فتحي','سارة محمود','أحمد عبد الله',
    'نور الهدى إبراهيم','محمود السيد','ياسمين عادل','خالد منصور','دينا رمضان','مصطفى كمال','رنا حامد','إسلام شريف',
    'آية مجدي','حسام الدين','شيماء فؤاد','طارق نبيل','ملك أشرف','زياد هشام','فاطمة الزهراء','عبد الرحمن سعيد',
    'هالة مصطفى','سامح عادل','نهى جمال','علي حسين','رحمة وليد','باسم رأفت','جنى محمد','حازم سليمان',
    'سلمى عصام','مازن خالد','إيمان صلاح','وائل فاروق','لمى أيمن','شريف عزت','دعاء نصر','أنس ممدوح'];
  sources  text[] := array['facebook','instagram','friend','google','friend','passing','facebook','returning','signboard',null];
  procs    text[] := array['كشف','حشو عادي','حشو عصب','خلع','تنظيف جير','تاج زيركون','تبييض','تقويم شهري','زرعة','حشو تجميلي'];
  prices   numeric[] := array[300, 600, 2500, 500, 700, 4500, 3500, 1500, 18000, 900];
  mins     int[] := array[20, 30, 60, 30, 40, 60, 60, 30, 90, 40];
  pid      uuid[];
  prid     uuid[];
begin
  perform setseed(0.42);

  insert into public.clinics (id, name, opens_at, closes_at, slot_minutes, address, closed_weekdays,
    booking_enabled, booking_slug, booking_show_prices, reviews_enabled, google_review_url,
    plan_status, plan_price, plan_renews_on, trial_ends_on)
  values (c, 'عيادة دنتانو التجريبية', '11:00', '21:00', 30, 'شارع الجيش، السويس', '{5}',
    true, 'demo', true, true, 'https://g.page/r/test-review-link/review',
    'active', 799, today + 20, null);

  insert into public.clinic_members (clinic_id, user_id, role, display_name, commission_percent, specialty) values
    (c, owner, 'owner', 'د. محمد دردير', 0, 'تركيبات'),
    (c, doc, 'doctor', 'د. ندى أحمد', 35, 'علاج جذور'),
    (c, rec, 'receptionist', 'سلمى أحمد', 0, null);

  insert into public.chairs (clinic_id, name) values (c, 'كرسي 1'), (c, 'كرسي 2');
  select array_agg(id order by name) into ch from public.chairs where clinic_id = c;

  perform public.seed_default_drugs(c);

  for i in 1..array_length(procs, 1) loop
    insert into public.procedures (clinic_id, name, default_price, default_duration_min, bookable_online)
    values (c, procs[i], prices[i], mins[i], i in (1, 2, 4, 5, 7));
  end loop;
  select array_agg(id order by default_price, name) into prid from public.procedures where clinic_id = c;

  -- ---------- Patients, spread over the last 90 days ----------
  for i in 1..array_length(names, 1) loop
    insert into public.patients (clinic_id, full_name, phone, gender, source, primary_doctor_id, created_at, medical_alerts)
    values (c, names[i], '010' || lpad((10000000 + i * 7919)::text, 8, '0'),
      case when names[i] ~ '^(منى|هبة|مريم|سارة|نور|ياسمين|دينا|رنا|آية|شيماء|ملك|فاطمة|هالة|نهى|رحمة|جنى|سلمى|إيمان|لمى|دعاء)' then 'female' else 'male' end,
      sources[1 + (i % array_length(sources, 1))],
      case when i % 3 = 0 then doc else owner end,
      now() - make_interval(days => (i * 37) % 90, hours => i % 9),
      case when i = 5 then 'حساسية بنسلين' when i = 12 then 'سكر' end);
  end loop;
  select array_agg(id order by created_at) into pid from public.patients where clinic_id = c;

  -- ---------- Materials, a lab, and what each procedure uses ----------
  perform set_config('request.jwt.claim.sub', owner::text, true);
  insert into public.materials (clinic_id, name, unit, min_stock, supplier_name) values
    (c, 'بنج كاربول', 'cartridge', 50, 'مخزن الشفاء'),
    (c, 'جوانتي', 'box', 5, 'مخزن الشفاء'),
    (c, 'حشو كومبوزيت', 'piece', 4, 'دنتال ستور'),
    (c, 'إبر', 'box', 3, 'مخزن الشفاء'),
    (c, 'ماسك', 'box', 4, 'مخزن الشفاء');
  for mat in select id from public.materials where clinic_id = c loop
    perform public.record_purchase(mat, 20, 1200, 'cash', today - 25, null);
  end loop;
  insert into public.procedure_materials (clinic_id, procedure_id, material_id, quantity)
  select c, pr2.id, m.id, 1 from public.procedures pr2, public.materials m
  where pr2.clinic_id = c and m.clinic_id = c and pr2.name in ('حشو عادي', 'حشو تجميلي') and m.name in ('بنج كاربول', 'حشو كومبوزيت');

  insert into public.labs (clinic_id, name, phone) values (c, 'معمل النور', '01011112222') returning id into lab;
  insert into public.lab_items (clinic_id, lab_id, name, unit_price) values (c, lab, 'تاج زيركون', 1200), (c, lab, 'تاج بورسلين', 800);

  -- ---------- Past appointments (last 45 days), today, and the next 2 weeks ----------
  perform set_config('request.jwt.claim.sub', rec::text, true);
  for d in select g::date from generate_series(today - 45, today + 14, interval '1 day') g loop
    continue when extract(dow from d) = 5;                 -- Friday off
    for slot in 0..(case when d = today then 9 when d < today then 4 + (extract(day from d)::int % 4) else 2 + (extract(day from d)::int % 3) end) loop
      i := 1 + ((extract(doy from d)::int * 7 + slot * 13) % array_length(pid, 1));
      st := case
        when d > today then 'booked'
        when d = today then (array['done','done','done','in_session','arrived','booked','booked','booked','booked','booked'])[slot + 1]::public.appointment_status
        when random() < 0.08 then 'no_show'
        when random() < 0.10 then 'cancelled'
        else 'done' end;
      insert into public.appointments (clinic_id, patient_id, chair_id, doctor_id, starts_at, ends_at, status, procedure_id, source)
      values (c, pid[i], ch[1 + slot % 2], case when slot % 2 = 0 then owner else doc end,
        (d + time '11:00' + make_interval(mins => (case when d = today then 0 else (extract(doy from d)::int % 3) * 60 end) + slot * 60 + (slot % 2) * 30)) at time zone tz,
        (d + time '11:00' + make_interval(mins => (case when d = today then 0 else (extract(doy from d)::int % 3) * 60 end) + slot * 60 + (slot % 2) * 30 + 30)) at time zone tz,
        st, prid[1 + (slot % 5)], case when slot = 2 and d > today then 'online' else 'clinic' end)
      on conflict do nothing;
    end loop;
  end loop;

  -- Two online requests still waiting for reception.
  insert into public.appointments (clinic_id, patient_id, chair_id, starts_at, ends_at, status, source, booked_name)
  values (c, pid[39], ch[2], (today + 2 + time '19:00') at time zone tz, (today + 2 + time '19:30') at time zone tz, 'booked', 'online', 'دعاء نصر'),
         (c, pid[40], ch[2], (today + 3 + time '20:00') at time zone tz, (today + 3 + time '20:30') at time zone tz, 'booked', 'online', 'أنس ممدوح')
  on conflict do nothing;
  update public.appointments set confirmed_at = created_at
  where clinic_id = c and not (source = 'online' and starts_at > now() + interval '1 day' and patient_id in (pid[39], pid[40]));

  -- ---------- Treatment plans ----------
  perform set_config('request.jwt.claim.sub', owner::text, true);
  for i in 1..16 loop
    insert into public.treatment_plans (clinic_id, patient_id, title, created_by)
    values (c, pid[i], (array['حشو وتنظيف','تركيبات','علاج عصب وتاج','تبييض','زرعة'])[1 + i % 5], owner)
    returning id into plan;
    insert into public.treatment_plan_items (clinic_id, plan_id, procedure_id, tooth_number, price)
    select c, plan, pr2.id, (array[16, 26, 36, 46, 11, 21])[1 + (k + i) % 6], pr2.default_price
    from generate_series(1, 2 + i % 3) k
    join public.procedures pr2 on pr2.id = prid[1 + ((i * 3 + k) % array_length(prid, 1))];

    update public.treatment_plans set status = 'presented' where id = plan;
    if i % 5 = 0 then
      update public.treatment_plans set status = 'declined',
        decline_reason = (array['السعر','هيفكر ويرجع','راح دكتور تاني'])[1 + i % 3] where id = plan;
    elsif i % 4 <> 0 then
      update public.treatment_plans set status = 'active' where id = plan;
      -- The first item is done in a session.
      select array_agg(id order by created_at) into items from public.treatment_plan_items where plan_id = plan;
      sess := public.record_session(pid[i], 'جلسة أولى، الحالة كويسة.', false, plan, items[1:1], null, case when i % 3 = 0 then doc else owner end);
      update public.sessions set performed_at = now() - make_interval(days => i * 2) where id = sess;
      -- Paid for what was done.
      insert into public.payments (clinic_id, patient_id, treatment_plan_id, receipt_no, amount, method, received_at, received_by)
      values (c, pid[i], plan, public._next_receipt_no(c),
        (select price from public.treatment_plan_items where id = items[1]),
        (array['cash','instapay','wallet','card'])[1 + i % 4]::public.payment_method, now() - make_interval(days => i * 2), rec);
    end if;
    update public.treatment_plans set presented_at = now() - make_interval(days => i * 2 + 1),
      accepted_at = case when accepted_at is not null then now() - make_interval(days => i * 2) end
    where id = plan;
  end loop;

  -- One plan on installments, with the down payment and a month paid.
  select id into plan from public.treatment_plans where clinic_id = c and status = 'active' order by created_at desc limit 1;
  if plan is not null then
    inst := public.create_installment_plan(plan, 1000, 4, today + 5);
  end if;

  -- ---------- Expenses ----------
  insert into public.expenses (clinic_id, spent_on, category, amount, method, note, created_by) values
    (c, date_trunc('month', today)::date, 'rent', 8000, 'bank_transfer', 'إيجار الشهر', owner),
    (c, date_trunc('month', today)::date + 1, 'salaries', 9000, 'cash', 'مرتبات', owner),
    (c, today - 6, 'utilities', 650, 'cash', 'كهرباء ومية', rec),
    (c, today - 3, 'other', 300, 'cash', 'بوفيه ونضافة', rec),
    (c, today - 12, 'marketing', 1500, 'card', 'إعلان فيسبوك', owner);

  -- ---------- Lab work ----------
  insert into public.lab_cases (clinic_id, patient_id, lab_id, description, shade, sent_on, expected_on, received_on, doctor_id, units, unit_price, created_by)
  values
    (c, pid[2], lab, 'تاج زيركون ضرس 36', 'A2', today - 9, today - 2, today - 3, owner, 1, 1200, owner),
    (c, pid[7], lab, 'تاجين بورسلين 11 و21', 'A1', today - 4, today + 3, null, owner, 2, 800, owner),
    (c, pid[11], lab, 'تاج زيركون ضرس 46', 'A3', today - 12, today - 4, null, doc, 1, 1200, doc);

  -- ---------- Post-visit reviews ----------
  insert into public.review_requests (clinic_id, appointment_id, patient_id, doctor_id, created_at, rating, comment, answered_at, went_to_google)
  select c, a.id, a.patient_id, a.doctor_id, a.ends_at,
         r.rating, r.comment, case when r.rating is not null then a.ends_at + interval '2 hours' end, coalesce(r.rating >= 4 and random() < 0.6, false)
  from (select a.*, row_number() over (order by a.starts_at desc) as n
        from public.appointments a where a.clinic_id = c and a.status = 'done' and a.starts_at < now()) a
  join lateral (select case
      when a.n % 9 = 0 then 2 when a.n % 13 = 0 then 3 when a.n % 5 = 0 then null
      when a.n % 4 = 0 then 4 else 5 end as rating,
      case when a.n % 9 = 0 then 'استنيت كتير بعد ميعادي.' when a.n % 7 = 0 then 'الدكتورة شاطرة جدًا.' end as comment) r on true
  where a.n <= 30;

  perform set_config('request.jwt.claim.sub', '', true);
end $$;

select 'Test clinic ready: ' || (select count(*) from public.patients) || ' patients, '
    || (select count(*) from public.appointments) || ' appointments, '
    || (select count(*) from public.treatment_plans) || ' plans.' as result;
