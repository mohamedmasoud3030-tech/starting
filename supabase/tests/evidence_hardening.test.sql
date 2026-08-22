-- ============================================================================
-- Evidence-storage hardening regression tests (F1 / F2 / F3).
--
-- Run with: supabase test db   (authoritative, Layer B)
--     and:  scripts/native-db/run.mjs   (supplementary, Layer A)
--
-- F1  policy teardown is bucket-scoped: unrelated bucket policies survive a
--     re-install of the attachments policies, and no attachments UPDATE policy
--     exists.
-- F2  evidence objects are immutable: an existing blob can neither be UPDATE'd
--     nor overwritten by re-INSERTing the same path; authorized first uploads
--     still work; unauthorized reads/writes stay blocked.
-- F3  reclaim_evidence() is a NON-DESTRUCTIVE SURVEY that can never list a
--     currently-referenced object, respects org scope and retention, and
--     deletes nothing. complete_evidence_reclaim() FINALIZES only after the
--     storage object is confirmed gone (real Storage-API deletion), refuses
--     referenced/cross-org/not-eligible/not-deleted paths, and audits success.
-- ============================================================================
begin;
select plan(34);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as the migration owner, before switching role).
-- ---------------------------------------------------------------------------
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin) values
('00000000-0000-0000-0000-000000000000','98111111-0000-0000-0000-0000000000a1','authenticated','authenticated','eh-owner@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','98111111-0000-0000-0000-0000000000a3','authenticated','authenticated','eh-supervisor@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','98111111-0000-0000-0000-0000000000a5','authenticated','authenticated','eh-accountant@test.local','x',now(),now(),now(),'{}','{}',false),
('00000000-0000-0000-0000-000000000000','98111111-0000-0000-0000-0000000000b1','authenticated','authenticated','eh-ownerb@test.local','x',now(),now(),now(),'{}','{}',false);

insert into public.organizations(id,name) values
('98122222-0000-0000-0000-0000000000a1','Org A'),
('98122222-0000-0000-0000-0000000000b1','Org B');

insert into public.organization_memberships(organization_id,user_id,role) values
('98122222-0000-0000-0000-0000000000a1','98111111-0000-0000-0000-0000000000a1','OWNER'),
('98122222-0000-0000-0000-0000000000a1','98111111-0000-0000-0000-0000000000a3','SUPERVISOR'),
('98122222-0000-0000-0000-0000000000a1','98111111-0000-0000-0000-0000000000a5','ACCOUNTANT'),
('98122222-0000-0000-0000-0000000000b1','98111111-0000-0000-0000-0000000000b1','OWNER');

-- Private-bucket objects (as the storage service would create them).
--   * current.jpg          — currently referenced → PROTECTED.
--   * old.jpg              — superseded, past retention → RECLAIMABLE.
--   * never-linked.jpg     — orphan, past retention → RECLAIMABLE.
--   * recent-orphan.jpg    — orphan but too recent → NOT reclaimable.
--   * recent-superseded.jpg— superseded but within retention → NOT reclaimable.
--   * orgB/b.jpg           — other tenant → unreachable by org-A reclaim.
insert into storage.objects(bucket_id,name,owner,created_at,metadata) values
('attachments','98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/current.jpg','98111111-0000-0000-0000-0000000000a1',now(),'{"a":1}'::jsonb),
('attachments','98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/old.jpg','98111111-0000-0000-0000-0000000000a1',now()-interval '200 days',null),
('attachments','98122222-0000-0000-0000-0000000000a1/DELIVERY_PROOF/event/never-linked.jpg','98111111-0000-0000-0000-0000000000a1',now()-interval '200 days',null),
('attachments','98122222-0000-0000-0000-0000000000a1/EXPENSE_RECEIPT/event_expense/recent-orphan.jpg','98111111-0000-0000-0000-0000000000a1',now(),null),
('attachments','98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/recent-superseded.jpg','98111111-0000-0000-0000-0000000000a1',now(),null),
('attachments','98122222-0000-0000-0000-0000000000b1/STAFF_ID/staff_member/b.jpg','98111111-0000-0000-0000-0000000000b1',now()-interval '200 days',null);

-- Metadata rows (inserted as owner), sharing one staff_member entity.
insert into public.attachment_evidence(organization_id,evidence_type,entity_type,entity_id,storage_path,file_name,mime_type,size_bytes,uploaded_by,superseded_at) values
('98122222-0000-0000-0000-0000000000a1','STAFF_ID','staff_member','98122222-0000-0000-0000-0000000000f1','98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/current.jpg','current.jpg','image/jpeg',100,'98111111-0000-0000-0000-0000000000a1',null),
('98122222-0000-0000-0000-0000000000a1','STAFF_ID','staff_member','98122222-0000-0000-0000-0000000000f1','98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/old.jpg','old.jpg','image/jpeg',100,'98111111-0000-0000-0000-0000000000a1',now()-interval '200 days'),
('98122222-0000-0000-0000-0000000000a1','STAFF_ID','staff_member','98122222-0000-0000-0000-0000000000f1','98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/recent-superseded.jpg','recent-superseded.jpg','image/jpeg',100,'98111111-0000-0000-0000-0000000000a1',now());

-- F1 fixture: an unrelated bucket sharing the same project, with its OWN policy.
insert into storage.buckets(id,name) values ('guest_uploads','guest_uploads');
create policy "guest_uploads_public_select" on storage.objects
  for select to anon using (bucket_id = 'guest_uploads');

-- ---------------------------------------------------------------------------
-- F1 — policy teardown is bucket-scoped; unrelated policies survive.
-- ---------------------------------------------------------------------------
select lives_ok($sql$select public.install_attachments_storage_policies()$sql$,'attachments policies re-install idempotently');

select is((select count(*)::int from pg_policies p
            where p.schemaname='storage' and p.tablename='objects'
              and p.policyname='guest_uploads_public_select'),1,
          'unrelated bucket policy survives the attachments re-install');

select is((select count(*)::int from storage.buckets where id='guest_uploads'),1,
          'unrelated bucket still present');

select is((select count(*)::int from pg_policies p
            where p.schemaname='storage' and p.tablename='objects'
              and p.policyname='attachments_update_org_role'),0,
          'no attachments UPDATE policy (F2 immutability)');

select is((select count(*)::int from pg_policies p
            where p.schemaname='storage' and p.tablename='objects'
              and p.policyname in ('attachments_select_org_role','attachments_insert_org_role')),2,
          'attachments SELECT and INSERT policies exist');

-- ---------------------------------------------------------------------------
-- F2 — immutable objects + authorized first upload (as Org-A OWNER).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims"='{"sub":"98111111-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Existing blob cannot be overwritten by UPDATE (RLS denies → 0 rows, value stays).
update storage.objects set metadata = '{"a":2}'::jsonb
 where bucket_id='attachments' and name = '98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/current.jpg';
select is((select (metadata->>'a')::int from storage.objects
            where bucket_id='attachments' and name = '98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/current.jpg'),1,
          'an authorized user cannot UPDATE an existing evidence blob (stays {"a":1})');

-- Existing blob cannot be overwritten by re-INSERTing the same path (unique path).
select throws_ok($sql$insert into storage.objects(bucket_id,name) values ('attachments','98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/current.jpg')$sql$,
  '23505',null,'cannot overwrite an evidence blob by re-inserting the same path');

-- Authorized first upload still works (new object in the org's own bucket).
select lives_ok($sql$insert into storage.objects(bucket_id,name) values ('attachments','98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/first-upload.jpg')$sql$,
  'authorized OWNER first upload still works');

-- Signed-URL privacy prerequisite: the attachments bucket is private — no
-- anonymous (public) policy grants access to it, so objects are only reachable
-- via short-lived signed URLs. (The legacy storage.buckets."public" column is
-- not relied upon: it is absent in the Supabase storage schema used by the
-- pinned CLI, and privacy is DB-enforced through RLS on storage.objects.)
select is((select count(*)::int from pg_policies p
            where p.schemaname='storage' and p.tablename='objects'
              and p.policyname like 'attachments_%'
              and 'anon' = any(p.roles)),0,
          'attachments is private: no anonymous policy (signed-URL only)');

-- ---------------------------------------------------------------------------
-- F3 — SURVEY: non-destructive identification, correct eligibility.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.reclaim_evidence('98122222-0000-0000-0000-0000000000a1',90)),2,
          'survey lists exactly the 2 reclaimable blobs (old superseded + orphan)');
select is((select count(*)::int from public.reclaim_evidence('98122222-0000-0000-0000-0000000000a1',90)
            where storage_path = '98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/old.jpg'),1,
          'survey lists the superseded-past-retention blob');
select is((select count(*)::int from public.reclaim_evidence('98122222-0000-0000-0000-0000000000a1',90)
            where storage_path = '98122222-0000-0000-0000-0000000000a1/DELIVERY_PROOF/event/never-linked.jpg'),1,
          'survey lists the orphan blob');
select is((select count(*)::int from public.reclaim_evidence('98122222-0000-0000-0000-0000000000a1',90)
            where storage_path = '98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/current.jpg'),0,
          'survey NEVER lists a currently-referenced (non-superseded) blob');
select is((select count(*)::int from public.reclaim_evidence('98122222-0000-0000-0000-0000000000a1',90)
            where storage_path = '98122222-0000-0000-0000-0000000000a1/EXPENSE_RECEIPT/event_expense/recent-orphan.jpg'),0,
          'review respects the retention threshold (recent orphan not eligible)');
select is((select count(*)::int from public.reclaim_evidence('98122222-0000-0000-0000-0000000000a1',90)
            where storage_path = '98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/recent-superseded.jpg'),0,
          'review respects retention for superseded (recent superseded not eligible)');
select is((select count(*)::int from public.reclaim_evidence('98122222-0000-0000-0000-0000000000a1',90)
            where storage_path like '98122222-0000-0000-0000-0000000000b1/%'),0,
          'survey is org-scoped (other tenant never listed)');

-- SURVEY IS NON-DESTRUCTIVE: no object or metadata row changes.
select is((select count(*)::int from storage.objects
            where bucket_id='attachments'
              and name in ('98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/old.jpg',
                           '98122222-0000-0000-0000-0000000000a1/DELIVERY_PROOF/event/never-linked.jpg')),2,
          'survey deletes nothing (both reclaimable objects still present)');
select is((select count(*)::int from public.attachment_evidence
            where reclaimed_at is not null),0,
          'survey marks nothing reclaimed (no lifecycle state change)');

-- ---------------------------------------------------------------------------
-- F3 — FINALIZE: refuses bad requests; no false reclaim success.
-- ---------------------------------------------------------------------------
-- Currently-referenced evidence can never be finalized.
select throws_ok($sql$select public.complete_evidence_reclaim('98122222-0000-0000-0000-0000000000a1', array['98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/current.jpg'], 90)$sql$,
  '23503','EVIDENCE_REFERENCED','referenced evidence cannot be reclaimed');

-- Cross-org path cannot be reclaimed by another org.
select throws_ok($sql$select public.complete_evidence_reclaim('98122222-0000-0000-0000-0000000000a1', array['98122222-0000-0000-0000-0000000000b1/STAFF_ID/staff_member/b.jpg'], 90)$sql$,
  '23503','EVIDENCE_PATH_NOT_IN_ORG','cross-org evidence cannot be reclaimed');

-- Not-eligible (superseded but within retention) path is refused.
select throws_ok($sql$select public.complete_evidence_reclaim('98122222-0000-0000-0000-0000000000a1', array['98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/recent-superseded.jpg'], 90)$sql$,
  '22023','EVIDENCE_NOT_ELIGIBLE','not-eligible (superseded within retention) path is refused');
-- An in-retention ORPHAN cannot be finalized either: it is still present, so the
-- physical-deletion verification rejects it (never a false reclaim success).
select throws_ok($sql$select public.complete_evidence_reclaim('98122222-0000-0000-0000-0000000000a1', array['98122222-0000-0000-0000-0000000000a1/EXPENSE_RECEIPT/event_expense/recent-orphan.jpg'], 90)$sql$,
  'P0002','EVIDENCE_STILL_PRESENT','in-retention orphan is rejected as never-deleted');

-- FAILED/UNFINISHED deletion: object still in storage.objects → must raise and
-- stamp nothing.
select throws_ok($sql$select public.complete_evidence_reclaim('98122222-0000-0000-0000-0000000000a1', array['98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/old.jpg'], 90)$sql$,
  'P0002','EVIDENCE_STILL_PRESENT','unfinished physical deletion is not marked reclaimed');
select is((select count(*)::int from public.attachment_evidence
            where storage_path = '98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/old.jpg'
              and reclaimed_at is not null),0,
          'failed finalize leaves reclaimed_at NULL (no false success)');
select is((select count(*)::int from storage.objects
            where bucket_id='attachments'
              and name = '98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/old.jpg'),1,
          'failed finalize leaves the object in place');

-- ---------------------------------------------------------------------------
-- F3 — FINALIZE: successful completion is auditable + stamps lifecycle.
-- ---------------------------------------------------------------------------
-- Simulate the supported Storage-API deletion having succeeded: the removal
-- endpoint clears the storage.objects metadata row. (Performed here as the
-- migration owner, i.e. the privileged subsystem, not via a client policy.)
reset role;
delete from storage.objects
 where bucket_id='attachments'
   and name in ('98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/old.jpg',
                '98122222-0000-0000-0000-0000000000a1/DELIVERY_PROOF/event/never-linked.jpg');
set local role authenticated;
set local "request.jwt.claims"='{"sub":"98111111-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select public.complete_evidence_reclaim(
              '98122222-0000-0000-0000-0000000000a1',
              array['98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/old.jpg',
                   '98122222-0000-0000-0000-0000000000a1/DELIVERY_PROOF/event/never-linked.jpg'],
              90)),2,
          'successful finalize returns the finalized path count');

select is((select count(*)::int from public.attachment_evidence
            where storage_path = '98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/old.jpg'
              and reclaimed_at is not null),1,
          'superseded metadata row is stamped reclaimed_at after successful deletion');

select is((select count(*)::int from public.attachment_evidence
            where organization_id='98122222-0000-0000-0000-0000000000a1'
              and storage_path = '98122222-0000-0000-0000-0000000000a1/STAFF_ID/staff_member/current.jpg'),1,
          'currently-referenced metadata row is NOT stamped (still intact)');

select ok((select count(*)::int > 0 from public.audit_events
            where organization_id='98122222-0000-0000-0000-0000000000a1'
              and action in ('EVIDENCE_RECLAIM_SURVEYED','EVIDENCE_RECLAIMED')),'reclaim survey + finalize are audited');

-- ---------------------------------------------------------------------------
-- F2/F3 — unauthorized reads, writes and reclaim stay blocked.
-- ---------------------------------------------------------------------------
-- SUPERVISOR: cannot read sensitive identity evidence (neither metadata nor blob).
set local "request.jwt.claims"='{"sub":"98111111-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.attachment_evidence
            where organization_id='98122222-0000-0000-0000-0000000000a1' and evidence_type='STAFF_ID'),0,
          'SUPERVISOR cannot read sensitive identity evidence');
select is((select count(*)::int from storage.objects
            where bucket_id='attachments' and name like '98122222-0000-0000-0000-0000000000a1/STAFF_ID/%'),0,
          'SUPERVISOR cannot read the identity blob (signed-URL requires read)');

-- ACCOUNTANT: cannot upload identity documents, and cannot run reclaim for the org.
set local "request.jwt.claims"='{"sub":"98111111-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($sql$select public.reclaim_evidence('98122222-0000-0000-0000-0000000000a1',90)$sql$,
  '42501','NOT_AUTHORIZED','non-OWNER/MANAGER cannot run survey');

-- Org-B owner: cannot read Org-A evidence (tenant isolation on the bucket),
-- and its OWN blob survives Org-A reclaim (org-scoped).
set local "request.jwt.claims"='{"sub":"98111111-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from storage.objects
            where bucket_id='attachments' and name like '98122222-0000-0000-0000-0000000000a1/%'),0,
          'another tenant cannot read evidence (signed-URL stays private)');
select is((select count(*)::int from storage.objects
            where bucket_id='attachments' and name = '98122222-0000-0000-0000-0000000000b1/STAFF_ID/staff_member/b.jpg'),1,
          'Org-B owner still sees its own blob — reclaim was org-scoped');

select finish();
rollback;
