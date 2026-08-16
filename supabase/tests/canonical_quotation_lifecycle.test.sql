begin;
select plan(49);

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','51000000-0000-0000-0000-000000000001','authenticated','authenticated','r11-owner@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','51000000-0000-0000-0000-000000000002','authenticated','authenticated','r11-supervisor@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false),
('00000000-0000-0000-0000-000000000000','51000000-0000-0000-0000-000000000003','authenticated','authenticated','r11-other@test.local','x',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false);
insert into public.organizations(id,name) values
('51000000-0000-0000-0000-0000000000a1','R11 A'),('51000000-0000-0000-0000-0000000000b2','R11 B');
insert into public.organization_memberships(organization_id,user_id,role,status) values
('51000000-0000-0000-0000-0000000000a1','51000000-0000-0000-0000-000000000001','OWNER','ACTIVE'),
('51000000-0000-0000-0000-0000000000a1','51000000-0000-0000-0000-000000000002','SUPERVISOR','ACTIVE'),
('51000000-0000-0000-0000-0000000000b2','51000000-0000-0000-0000-000000000003','OWNER','ACTIVE');
insert into public.catalog_items(id,organization_id,name,item_type,unit,pricing_method,cost_price,selling_price) values
('51000000-0000-0000-0000-0000000000c1','51000000-0000-0000-0000-0000000000a1','قهوة','SERVICE','ضيف','PER_GUEST',1.250,2.800),
('51000000-0000-0000-0000-0000000000c2','51000000-0000-0000-0000-0000000000a1','تمر','CONSUMABLE','علبة','PER_UNIT',0.300,0.800);
insert into public.packages(id,organization_id,name,status) values
('51000000-0000-0000-0000-0000000000d1','51000000-0000-0000-0000-0000000000a1','ضيافة','ACTIVE');
insert into public.package_items(organization_id,package_id,catalog_item_id,quantity,sort_order) values
('51000000-0000-0000-0000-0000000000a1','51000000-0000-0000-0000-0000000000d1','51000000-0000-0000-0000-0000000000c1',1,0),
('51000000-0000-0000-0000-0000000000a1','51000000-0000-0000-0000-0000000000d1','51000000-0000-0000-0000-0000000000c2',5,1);

select has_table('public','quotations','canonical quotations table exists');
select has_table('public','quotation_lines','canonical quotation lines table exists');
select hasnt_table('public','quick_quotes','legacy quick quote aggregate removed');
select hasnt_table('public','quick_quote_lines','legacy quick quote lines removed');
select hasnt_table('public','quick_quote_applied_packages','legacy package marker removed');
select has_function('public','create_quotation_draft',array['uuid','text','uuid','text','text','text','text','text','timestamp with time zone','timestamp with time zone','integer','text','text','uuid'],'canonical create command exists');
select has_function('public','issue_quotation',array['uuid','uuid','text','text','uuid'],'canonical issue command exists');
select has_function('public','convert_quotation_to_event',array['uuid','uuid','uuid','timestamp with time zone','timestamp with time zone','text','integer','text'],'canonical conversion exists');
select hasnt_function('public','create_quick_quote',array['uuid','text','text','text','text','text','text','timestamp with time zone','timestamp with time zone','integer','text','text','uuid'],'legacy create RPC removed');
select ok('DRAFT'::public.quotation_status is not null,'DRAFT state exists');
select ok('CONVERTED'::public.quotation_status is not null,'CONVERTED state exists');
select ok('CANCELLED'::public.quotation_status is not null,'CANCELLED state exists');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_quotation_draft(
 '51000000-0000-0000-0000-0000000000a1','سعيد',null,'99887766',null,null,'حفل','OTHER',
 '2026-09-01 10:00+04','2026-09-01 14:00+04',120,'قاعة الريان',null,
 '51000000-0000-0000-0000-000000000101')$$,'prospect-first draft created');
select is((select status::text from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'DRAFT','new quotation is DRAFT');
select is((select quotation_number from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),null,'draft has no official number');
select lives_ok($$select public.create_quotation_draft(
 '51000000-0000-0000-0000-0000000000a1','سعيد',null,'99887766',null,null,'حفل','OTHER',
 '2026-09-01 10:00+04','2026-09-01 14:00+04',120,'قاعة الريان',null,
 '51000000-0000-0000-0000-000000000101')$$,'identical create replays safely');
select throws_ok($$select public.create_quotation_draft(
 '51000000-0000-0000-0000-0000000000a1','مختلف',null,null,null,null,null,null,null,null,null,null,null,
 '51000000-0000-0000-0000-000000000101')$$,'22023','IDEMPOTENCY_KEY_PAYLOAD_MISMATCH','conflicting replay rejected');
select is((select public.apply_package_to_quotation('51000000-0000-0000-0000-0000000000a1',(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'51000000-0000-0000-0000-0000000000d1')),2,'package expands into two quote-owned lines');
select throws_ok($$select public.apply_package_to_quotation('51000000-0000-0000-0000-0000000000a1',(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'51000000-0000-0000-0000-0000000000d1')$$,'P0001','PACKAGE_ALREADY_APPLIED','same package cannot double apply');
select is((select total_selling::text from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'340.000','server-authored package total is exact');
select is((select total_expected_cost::text from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'151.500','expected cost is exact');
select lives_ok($$select public.issue_quotation('51000000-0000-0000-0000-0000000000a1',(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),null,null,'51000000-0000-0000-0000-000000000102')$$,'draft issues transactionally');
select is((select status::text from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'ISSUED','issued state persisted');
select ok((select quotation_number like 'QT-%' from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'official number allocated only at issue');
select throws_ok($$select public.save_quotation_line('51000000-0000-0000-0000-0000000000a1',(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),null,'تغيير','SERVICE','وحدة','FIXED',1,1,0,true,null,null,null)$$,'P0001','QUOTATION_NOT_EDITABLE','issued lines cannot be edited through command');
reset role;
select throws_ok($$update public.quotations set total_selling=0 where idempotency_key='51000000-0000-0000-0000-000000000101'$$,'P0001','QUOTATION_IMMUTABLE','issued aggregate immutable even to privileged SQL');
select throws_ok($$update public.quotation_lines set unit_selling_price=0 where quotation_id=(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101')$$,'P0001','QUOTATION_IMMUTABLE','issued line immutable even to privileged SQL');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.accept_quotation('51000000-0000-0000-0000-0000000000a1',(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'51000000-0000-0000-0000-000000000103')$$,'issued quote accepted');
select lives_ok($$select public.convert_quotation_to_event('51000000-0000-0000-0000-0000000000a1',(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'51000000-0000-0000-0000-000000000104',null,null,null,null,null)$$,'accepted quote converts');
select is((select status::text from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'CONVERTED','quotation reaches CONVERTED');
select is((select count(*)::int from public.events where accepted_quotation_id=(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101')),1,'exactly one event created');
select is((select count(*)::int from public.event_commercial_lines where event_id=(select converted_event_id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101')),2,'commercial snapshots copied to event');

-- Complete draft persistence is one atomic aggregate replacement.
select lives_ok($$select public.create_quotation_draft(
 '51000000-0000-0000-0000-0000000000a1','مريم',null,'99112233',null,null,'اجتماع','OTHER',
 '2026-09-05 10:00+04','2026-09-05 12:00+04',20,'مسقط',null,
 '51000000-0000-0000-0000-000000000106')$$,'second draft created for aggregate-save proof');
select lives_ok($$select public.save_quotation_draft(
 '51000000-0000-0000-0000-0000000000a1',
 (select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000106'),
 'مريم',null,'99112233',null,null,'اجتماع','OTHER','2026-09-05 10:00+04','2026-09-05 12:00+04',20,'مسقط',null,
 '[{"id":"51000000-0000-0000-0000-0000000000e1","description":"خدمة","item_type":"SERVICE","unit":"مناسبة","pricing_method":"FIXED","quantity":"1.000","unit_selling_price":"25.000","expected_unit_cost":"10.000","is_custom":true,"source_catalog_item_id":null,"source_package_id":null},
   {"id":"51000000-0000-0000-0000-0000000000e2","description":"تمر","item_type":"CONSUMABLE","unit":"علبة","pricing_method":"PER_UNIT","quantity":"2.000","unit_selling_price":"0.800","expected_unit_cost":"0.300","is_custom":false,"source_catalog_item_id":"51000000-0000-0000-0000-0000000000c2","source_package_id":"51000000-0000-0000-0000-0000000000d1"}]'::jsonb)$$,'header and complete draft lines save atomically');
select is((select count(*)::int from public.quotation_lines where quotation_id=(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000106')),2,'aggregate save persists both lines');
select is((select total_selling::text||'/'||total_expected_cost::text from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000106'),'26.600/10.600','aggregate totals are authored exactly by server');
select is((select source_catalog_item_id::text||'/'||source_package_id::text from public.quotation_lines where id='51000000-0000-0000-0000-0000000000e2'),'51000000-0000-0000-0000-0000000000c2/51000000-0000-0000-0000-0000000000d1','package provenance survives aggregate save');
select lives_ok($$select public.save_quotation_draft(
 '51000000-0000-0000-0000-0000000000a1',
 (select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000106'),
 'مريم',null,'99112233',null,null,'اجتماع','OTHER','2026-09-05 10:00+04','2026-09-05 12:00+04',20,'مسقط',null,
 '[{"id":"51000000-0000-0000-0000-0000000000e1","description":"خدمة معدلة","item_type":"SERVICE","unit":"مناسبة","pricing_method":"PER_UNIT","quantity":"2.000","unit_selling_price":"30.000","expected_unit_cost":"11.000","is_custom":true}]'::jsonb)$$,'replacement save updates and deletes in one transaction');
select is((select count(*)::int from public.quotation_lines where quotation_id=(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000106')),1,'omitted persisted line is deleted');
select is((select description||'/'||pricing_method::text||'/'||quantity::text||'/'||unit_selling_price::text||'/'||expected_unit_cost::text from public.quotation_lines where id='51000000-0000-0000-0000-0000000000e1'),'خدمة معدلة/PER_UNIT/2.000/30.000/11.000','persisted line edit replaces every commercial field exactly');
select lives_ok($$select public.save_quotation_draft(
 '51000000-0000-0000-0000-0000000000a1',
 (select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000106'),
 'مريم',null,'99112233',null,null,'اجتماع','OTHER','2026-09-05 10:00+04','2026-09-05 12:00+04',20,'مسقط',null,
 '[{"id":"51000000-0000-0000-0000-0000000000e1","description":"خدمة معدلة","item_type":"SERVICE","unit":"مناسبة","pricing_method":"PER_UNIT","quantity":"2.000","unit_selling_price":"30.000","expected_unit_cost":"11.000","is_custom":true}]'::jsonb)$$,'identical repeated save is safe');
select is((select count(*)::int from public.quotation_lines where quotation_id=(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000106')),1,'repeated save never duplicates lines');
select lives_ok($$select public.issue_quotation('51000000-0000-0000-0000-0000000000a1',(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000106'),null,null,'51000000-0000-0000-0000-000000000107')$$,'aggregate-saved draft can issue');
select throws_ok($$select public.save_quotation_draft(
 '51000000-0000-0000-0000-0000000000a1',
 (select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000106'),
 'مريم',null,null,null,null,null,null,null,null,null,null,null,'[]'::jsonb)$$,'P0001','QUOTATION_NOT_EDITABLE','aggregate save cannot weaken issued immutability');

select lives_ok($$select public.convert_quotation_to_event('51000000-0000-0000-0000-0000000000a1',(select id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'51000000-0000-0000-0000-000000000104',null,null,null,null,null)$$,'conversion replay returns safely');
select lives_ok($$select public.create_event_invoice('51000000-0000-0000-0000-0000000000a1',(select converted_event_id from public.quotations where idempotency_key='51000000-0000-0000-0000-000000000101'),'INV-R11-1',null,340.000,'[{"seq":0,"kind":"DEPOSIT","due_date":"2026-09-02","amount":"100.000"},{"seq":1,"kind":"FINAL","due_date":"2026-09-10","amount":"240.000"}]'::jsonb,null,'51000000-0000-0000-0000-000000000105')$$,'converted quotation remains invoice authority');

set local "request.jwt.claims"='{"sub":"51000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.create_quotation_draft('51000000-0000-0000-0000-0000000000a1','غير مصرح')$$,'42501',null,'supervisor cannot create commercial draft');
select throws_ok($$select count(*) from public.command_idempotency$$,'42501',null,'raw replay register inaccessible to authenticated user');
set local "request.jwt.claims"='{"sub":"51000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.accept_quotation('51000000-0000-0000-0000-0000000000a1',(select id from public.quotations where organization_id='51000000-0000-0000-0000-0000000000a1' limit 1))$$,'42501',null,'cross-organization acceptance rejected');

select * from finish();
rollback;
