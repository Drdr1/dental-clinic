\set ON_ERROR_STOP 0
\pset footer off
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c');

-- ===== Owner (the doctor) sets up the clinic
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.create_clinic('Smile Dental', 'Dr. Brother') as clinic \gset
insert into clinic_members (clinic_id,user_id,role,display_name) values (:'clinic','00000000-0000-0000-0000-00000000000b','receptionist','Receptionist');
insert into chairs (clinic_id,name) values (:'clinic','Chair 1') returning id as chair \gset
insert into procedures (clinic_id,name,default_price) values (:'clinic','Implant',10000) returning id as proc \gset
insert into patients (clinic_id,full_name,phone) values (:'clinic','Mona Ali','01000000000') returning id as pat \gset

-- Plan A: 2 implants = 20,000, down 5,000, 7 months starting Jan 31
insert into treatment_plans (clinic_id,patient_id,title) values (:'clinic',:'pat','Implants') returning id as tpa \gset
insert into treatment_plan_items (clinic_id,plan_id,procedure_id,tooth_number,price) values (:'clinic',:'tpa',:'proc',36,10000),(:'clinic',:'tpa',:'proc',46,10000);
select public.create_installment_plan(:'tpa', 5000, 7, '2026-01-31') as ipa \gset
\echo '--- schedule (expect 31 Jan, 28 Feb, 31 Mar, 30 Apr ..., last absorbs rounding)'
select seq, is_down_payment, due_date, amount, status from installment_status where installment_plan_id = :'ipa' order by seq;
select sum(amount) as schedule_total from installments where installment_plan_id = :'ipa';

-- ===== Receptionist records payments
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
\echo '--- receptionist cannot create installment terms (expect error)'
select public.create_installment_plan(:'tpa', 0, 3, '2026-10-01');
\echo '--- receptionist cannot insert payments directly (expect error)'
insert into payments (clinic_id,patient_id,receipt_no,amount,method) values (:'clinic',:'pat',999,100,'cash');
select public.record_payment(:'ipa', 5000, 'cash', 'down payment') as p1 \gset
select public.record_payment(:'ipa', 3000, 'instapay') as p2 \gset
\echo '--- after 5000 + 3000: down paid, #1 paid (2142), #2 partial (858)'
select seq, amount, paid, remaining, is_partial, status from installment_status where installment_plan_id = :'ipa' order by seq limit 4;
\echo '--- overpay rejected (expect error)'
select public.record_payment(:'ipa', 999999, 'cash');
\echo '--- update/delete payment blocked (expect errors)'
update payments set amount = 1 where id = :'p2';
delete from payments where id = :'p2';
\echo '--- receptionist cannot reverse (expect error)'
select public.reverse_payment(:'p2', 'wrong amount');

-- ===== Owner reverses p2
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.reverse_payment(:'p2', 'entered wrong amount') as r2 \gset
select receipt_no, amount, reverses_payment_id is not null as is_reversal, note from payments order by receipt_no;
select seq, paid, remaining, status from installment_status where installment_plan_id = :'ipa' order by seq limit 3;
\echo '--- double reversal rejected (expect error)'
select public.reverse_payment(:'p2', 'again');

-- ===== Session lock: plan A has 6 overdue monthly installments + part of #1? check
select overdue_count, outstanding, sessions_locked from installment_plan_summary where installment_plan_id = :'ipa';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
\echo '--- receptionist session on locked plan (expect SESSION_LOCKED)'
insert into sessions (clinic_id,patient_id,treatment_plan_id) values (:'clinic',:'pat',:'tpa');
\echo '--- receptionist override attempt (expect only doctor error)'
insert into sessions (clinic_id,patient_id,treatment_plan_id,lock_override,override_reason) values (:'clinic',:'pat',:'tpa',true,'pain');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
\echo '--- doctor override without reason (expect check error)'
insert into sessions (clinic_id,patient_id,treatment_plan_id,lock_override) values (:'clinic',:'pat',:'tpa',true);
\echo '--- doctor override with reason (expect success, override_by set)'
insert into sessions (clinic_id,patient_id,treatment_plan_id,lock_override,override_reason) values (:'clinic',:'pat',:'tpa',true,'Acute pain') returning lock_override, override_reason, override_by;

-- Plan B: threshold edge: Aug 1 + Sep 1 overdue(2), Oct/Nov upcoming
insert into treatment_plans (clinic_id,patient_id,title) values (:'clinic',:'pat','Ortho') returning id as tpb \gset
insert into treatment_plan_items (clinic_id,plan_id,price,description) values (:'clinic',:'tpb',8000,'Braces');
select public.create_installment_plan(:'tpb', 0, 4, '2026-08-01') as ipb \gset
select seq, due_date, grace_end, status, days_overdue from installment_status where installment_plan_id = :'ipb' order by seq;
select overdue_count, sessions_locked from installment_plan_summary where installment_plan_id = :'ipb';
select public.record_payment(:'ipb', 2000, 'cash');
\echo '--- after paying 1: 1 overdue -> normal session allowed, override flags stripped'
insert into sessions (clinic_id,patient_id,treatment_plan_id,lock_override,override_reason) values (:'clinic',:'pat',:'tpb',true,'x') returning lock_override, override_reason;

-- Revision: treatment for plan B reduced to 6000 (discount 2000)
update treatment_plans set discount = 2000 where id = :'tpb';
select needs_revision from installment_plan_summary where installment_plan_id = :'ipb';
select public.revise_installment_plan(:'ipb', 2, '2026-10-01', 'Discount agreed');
select seq, due_date, amount, paid, status from installment_status where installment_plan_id = :'ipb' order by seq;
select net_total, outstanding, needs_revision from installment_plan_summary where installment_plan_id = :'ipb';

\echo '--- agenda & reliability'
select full_name, seq, due_date, remaining, status from installment_agenda order by due_date limit 5;
select * from patient_payment_reliability;

\echo '--- appointment overlap (expect exclusion error on 2nd)'
insert into appointments (clinic_id,patient_id,chair_id,starts_at,ends_at) values (:'clinic',:'pat',:'chair','2026-09-20 10:00+02','2026-09-20 10:30+02');
insert into appointments (clinic_id,patient_id,chair_id,starts_at,ends_at) values (:'clinic',:'pat',:'chair','2026-09-20 10:15+02','2026-09-20 10:45+02');

\echo '--- owner cannot tamper receipt counter (expect permission error)'
update clinics set next_receipt_no = 1 where id = :'clinic';
update clinics set grace_days = 5 where id = :'clinic' returning grace_days;

-- ===== Other tenant
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select public.create_clinic('Other Clinic', 'X') as other \gset
\echo '--- tenant isolation (expect zeros)'
select (select count(*) from patients) p, (select count(*) from payments) pay, (select count(*) from installment_status) inst;
\echo '--- cross-tenant insert into clinic A (expect RLS error)'
insert into patients (clinic_id,full_name,phone) values (:'clinic','Hack','1');
\echo '--- cross-tenant FK: appointment in own clinic referencing clinic A patient (expect FK error)'
insert into chairs (clinic_id,name) values (:'other','C') returning id as ochair \gset
insert into appointments (clinic_id,patient_id,chair_id,starts_at,ends_at) values (:'other',:'pat',:'ochair',now(),now()+interval '30 min');
\echo '--- record payment on clinic A plan (expect Not allowed)'
select public.record_payment(:'ipa', 10, 'cash');
reset role;
\echo '--- anon cannot read'
set role anon; select count(*) from patients;
