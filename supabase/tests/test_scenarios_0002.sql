-- Local testing only. Run after 0001 + test_scenarios.sql (it reuses that data):
--   psql -d clinic_test -1 -f 0002_clinic_operations.sql
--   psql -d clinic_test -f test_scenarios_0002.sql
-- Expect 15 intentional ERROR lines.

\pset footer off
\echo '=== backfill: agreements for plans created before 0002'
select installment_plan_id is not null ok, version, terms->>'reason' reason, jsonb_array_length(terms->'schedule') sched from installment_agreements;

insert into auth.users values ('00000000-0000-0000-0000-00000000000d');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select id as clinic from clinics where name='Smile Dental' \gset
insert into clinic_members (clinic_id,user_id,role,display_name) values (:'clinic','00000000-0000-0000-0000-00000000000d','receptionist','R2');
insert into patients (clinic_id,full_name,phone,recall_interval_months) values (:'clinic','Omar Hassan','01111111111',6) returning id as pat \gset

\echo '=== 1. lifecycle: draft -> presented -> active via installments'
insert into treatment_plans (clinic_id,patient_id,title) values (:'clinic',:'pat','Crowns') returning id as tp \gset
insert into treatment_plan_items (clinic_id,plan_id,description,price,tooth_number) values (:'clinic',:'tp','Zirconia crown',4000,36),(:'clinic',:'tp','Zirconia crown',4000,46);
update treatment_plans set status='presented' where id=:'tp' returning status, presented_at is not null presented;
\echo '--- invalid jump presented -> completed (expect error)'
update treatment_plans set status='completed' where id=:'tp';
select public.create_installment_plan(:'tp', 2000, 3, '2026-10-19') as ip \gset
select status, accepted_at is not null accepted from treatment_plans where id=:'tp';
\echo '--- agreement v1 created at commit'
select version, terms->>'net_total' net, terms->'rules' rules, jsonb_array_length(terms->'schedule') sched, signed_at from installment_agreements where installment_plan_id=:'ip';
\echo '--- cancel treatment plan while installments active (expect error)'
update treatment_plans set status='cancelled' where id=:'tp';

\echo '--- declined plan'
insert into treatment_plans (clinic_id,patient_id,title) values (:'clinic',:'pat','Veneers') returning id as tp2 \gset
insert into treatment_plan_items (clinic_id,plan_id,description,price) values (:'clinic',:'tp2','Veneer x6',30000);
update treatment_plans set status='presented' where id=:'tp2';
update treatment_plans set status='declined', decline_reason='Too expensive' where id=:'tp2';
\echo '--- declined -> active directly (expect error; must re-present)'
update treatment_plans set status='active' where id=:'tp2';
select * from case_acceptance_monthly where clinic_id=:'clinic';
select full_name, title, remaining_value, remaining_items from unscheduled_treatment where patient_id=:'pat';

\echo '=== 5. revision -> agreement v2; sign rules'
select id as a1 from installment_agreements where installment_plan_id=:'ip' and version=1 \gset
update treatment_plan_items set status='cancelled' where plan_id=:'tp' and tooth_number=46;
select public.revise_installment_plan(:'ip', 2, '2026-10-19', 'One crown removed from plan');
select version, terms->>'net_total' net, terms->>'reason' reason from installment_agreements where installment_plan_id=:'ip' order by version;
\echo '--- sign old version (expect error)'
select public.sign_installment_agreement(:'a1','Omar Hassan','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA');
select id as a2 from installment_agreements where installment_plan_id=:'ip' and version=2 \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select public.sign_installment_agreement(:'a2','Omar Hassan','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA');
\echo '--- sign twice (expect error)'
select public.sign_installment_agreement(:'a2','Someone','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA');
select public.attach_agreement_document(:'a2', :'clinic' || '/' || :'pat' || '/agreement-v2.pdf');
\echo '--- direct update of terms (expect permission error)'
update installment_agreements set terms='{}' where id=:'a2';
select version, signed_by_name, signed_at is not null signed, document_path is not null has_pdf from installment_agreements where installment_plan_id=:'ip' order by version;
\echo '--- cancel installment plan: receptionist (expect error), then doctor'
select public.cancel_installment_plan(:'ip','x');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.cancel_installment_plan(:'ip','Patient moved abroad');
update treatment_plans set status='cancelled' where id=:'tp' returning status;

\echo '=== 2. recall'
select id as chair from chairs where clinic_id=:'clinic' limit 1 \gset
insert into sessions (clinic_id,patient_id,is_recall_visit,performed_at) values (:'clinic',:'pat',true,'2026-03-10 11:00+02');
select full_name, recall_type, next_recall_due from patients where id=:'pat';
select full_name, next_recall_due, status, days_overdue, has_upcoming_appointment from recall_list where patient_id=:'pat';
insert into appointments (clinic_id,patient_id,chair_id,starts_at,ends_at) values (:'clinic',:'pat',:'chair', now()+interval '2 days', now()+interval '2 days 30 min');
select has_upcoming_appointment from recall_list where patient_id=:'pat';

\echo '=== 3. lab cases'
insert into labs (clinic_id,name) values (:'clinic','Nile Dental Lab') returning id as lab \gset
insert into lab_cases (clinic_id,patient_id,lab_id,description,sent_on,expected_on,lab_fee) values (:'clinic',:'pat',:'lab','Zirconia crown 36', current_date-5, current_date+4, 900) returning id as lc \gset
select lab_name, status, next_appointment_at is not null booked, at_risk from lab_case_status where id=:'lc';
update lab_cases set received_on=current_date where id=:'lc';
select status, turnaround_days, at_risk from lab_case_status where id=:'lc';
\echo '--- fitted before received check (expect error)'
insert into lab_cases (clinic_id,patient_id,lab_id,description,sent_on,expected_on,fitted_on) values (:'clinic',:'pat',:'lab','x',current_date,current_date,current_date);

\echo '=== 4. forms'
insert into form_templates (clinic_id,kind,title,body) values (:'clinic','medical_history','Medical history','{"questions":[{"id":"allergies","label":"Any allergies?"}]}') returning id as tmpl \gset
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
\echo '--- receptionist creating template (expect RLS error)'
insert into form_templates (clinic_id,kind,title,body) values (:'clinic','consent','Hack','{}');
select public.create_form_request(:'pat', :'tmpl') as token \gset
select length(:'token') token_len;
reset role;
set role anon;
set request.jwt.claim.sub = '';
\echo '--- anon loads form'
select public.get_form_by_token(:'token') ->> 'patient_first_name' first_name, public.get_form_by_token(:'token') ->> 'title' title;
\echo '--- anon wrong token (expect error)'
select public.get_form_by_token('nope');
select public.submit_form(:'token', '{"allergies":"Penicillin"}', 'Omar Hassan', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA') is not null submitted;
\echo '--- reuse link (expect error)'
select public.submit_form(:'token', '{"allergies":"none"}', 'Omar Hassan', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA');
\echo '--- anon reading tables / calling staff RPCs (expect permission errors)'
select count(*) from form_submissions;
select public.create_form_request(:'pat', :'tmpl');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select answers, needs_update from latest_medical_history where patient_id=:'pat';
\echo '--- edit signed template (expect error)'
update form_templates set body='{"questions":[]}' where id=:'tmpl';
\echo '--- edit submission (expect permission error)'
update form_submissions set answers='{}';

\echo '=== isolation: other clinic sees nothing new'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select (select count(*) from lab_cases) lab, (select count(*) from form_submissions) forms, (select count(*) from installment_agreements) agr, (select count(*) from recall_list) recall;
