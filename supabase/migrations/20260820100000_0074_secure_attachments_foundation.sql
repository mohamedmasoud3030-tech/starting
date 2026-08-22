-- ============================================================================
-- 0074 — Secure attachments foundation (private evidence system)
--
-- ONE centralized private-evidence subsystem replaces the idea of ad-hoc
-- image columns scattered across tables. Every sensitive/operational proof
-- (staff ID, contract, attendance selfies, payout receipts, expense receipts,
-- delivery/return/damage proof, delivery signature) is stored as:
--
--   * a private Supabase Storage object under `attachments/{org}/{type}/…`, and
--   * one `attachment_evidence` metadata row that points at it.
--
-- Guarantees enforced IN THE DATABASE (never in the UI):
--   * organization-scoped paths + tenant-isolated metadata (RLS + FK shape)
--   * a maximum file size and an allow-list of image/PDF MIME types
--   * signed-URL access only — the bucket is private, storage SELECT policies
--     are role-gated per evidence type (no public URLs, no cross-tenant read)
--   * a dedicated sensitive-staff-evidence permission boundary that is NOT
--     `can_read_cost`: OWNER/MANAGER see ID cards + contracts + selfies;
--     ACCOUNTANT/SUPERVISOR/WAREHOUSE do not (operational evidence stays
--     visible to operational roles where appropriate)
--   * an audit trail via the existing `record_audit`
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Evidence type enum — the single taxonomy for all attachments.
-- ---------------------------------------------------------------------------
create type public.attachment_evidence_type as enum (
  'STAFF_ID',
  'STAFF_CONTRACT',
  'ATTENDANCE_CHECKIN',
  'ATTENDANCE_CHECKOUT',
  'HOST_PAYOUT_RECEIPT',
  'EXPENSE_RECEIPT',
  'DELIVERY_PROOF',
  'RETURN_PROOF',
  'EQUIPMENT_DAMAGE'
);

-- ---------------------------------------------------------------------------
-- 2. Permission boundaries (DB-authoritative; distinct from can_read_cost).
-- ---------------------------------------------------------------------------
-- Sensitive identity documents (ID card, contract, attendance selfies):
-- OWNER + MANAGER only. ACCOUNTANT must NOT see them merely because it can
-- read costs; SUPERVISOR and WAREHOUSE are excluded.
create or replace function public.can_view_sensitive_staff_evidence(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]);
$$;

-- Operational handover evidence (delivery/return/damage): warehouse operators
-- see it in addition to OWNER/MANAGER.
create or replace function public.can_view_operational_evidence(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role, 'WAREHOUSE'::public.app_role]);
$$;

-- Financial evidence (payout receipts, expense receipts): the accounting roles.
create or replace function public.can_view_financial_evidence(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role, 'ACCOUNTANT'::public.app_role]);
$$;

-- Read gate: which roles may READ a given evidence type for an org.
create or replace function public.attachment_evidence_read_gate(
  p_org_id uuid,
  p_evidence_type public.attachment_evidence_type
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_evidence_type in ('STAFF_ID','STAFF_CONTRACT','ATTENDANCE_CHECKIN','ATTENDANCE_CHECKOUT')
      then public.can_view_sensitive_staff_evidence(p_org_id)
    when p_evidence_type in ('DELIVERY_PROOF','RETURN_PROOF','EQUIPMENT_DAMAGE')
      then public.can_view_operational_evidence(p_org_id)
    when p_evidence_type in ('HOST_PAYOUT_RECEIPT','EXPENSE_RECEIPT')
      then public.can_view_financial_evidence(p_org_id)
    else false
  end;
$$;

-- Write gate: which roles may UPLOAD a given evidence type for an org.
-- SUPERVISOR may capture attendance selfies (clock in/out) but not read them
-- afterwards; it may never touch identity documents.
create or replace function public.attachment_evidence_write_gate(
  p_org_id uuid,
  p_evidence_type public.attachment_evidence_type
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_evidence_type in ('STAFF_ID','STAFF_CONTRACT')
      then public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role])
    when p_evidence_type in ('ATTENDANCE_CHECKIN','ATTENDANCE_CHECKOUT')
      then public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role, 'SUPERVISOR'::public.app_role])
    when p_evidence_type in ('DELIVERY_PROOF','RETURN_PROOF','EQUIPMENT_DAMAGE')
      then public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role, 'WAREHOUSE'::public.app_role])
    when p_evidence_type in ('HOST_PAYOUT_RECEIPT','EXPENSE_RECEIPT')
      then public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role, 'ACCOUNTANT'::public.app_role])
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Metadata table.
-- ---------------------------------------------------------------------------
create table public.attachment_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  evidence_type public.attachment_evidence_type not null,
  entity_type text not null check (length(trim(entity_type)) > 0),
  entity_id uuid not null,
  storage_path text not null,
  file_name text not null check (length(trim(file_name)) > 0),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  uploaded_by uuid not null references auth.users(id),
  metadata jsonb,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),

  constraint attachment_evidence_org_id_unique unique (organization_id, id),
  constraint attachment_evidence_storage_path_unique unique (organization_id, storage_path),
  constraint attachment_evidence_path_org_scoped check (
    -- The first path token MUST be the owning organization id, so a metadata
    -- row can never point at another tenant's object prefix.
    split_part(storage_path, '/', 1) = organization_id::text
  )
);

create index attachment_evidence_entity_idx
  on public.attachment_evidence (organization_id, entity_type, entity_id, created_at desc);
create index attachment_evidence_type_idx
  on public.attachment_evidence (organization_id, evidence_type, created_at desc);

alter table public.attachment_evidence enable row level security;

create policy "attachment_evidence_select_org_role" on public.attachment_evidence
  for select
  using (
    public.is_org_member(organization_id)
    and public.attachment_evidence_read_gate(organization_id, evidence_type)
  );

-- No client INSERT/UPDATE/DELETE policies: every write goes through the
-- server-authoritative commands below (which run as the function owner and
-- therefore bypass RLS), keeping the evidence append-only at the client edge.
revoke all on table public.attachment_evidence from anon;
grant select on table public.attachment_evidence to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Private storage bucket + org/role-scoped storage policies.
--    A single, idempotent, BUCKET-SCOPED installer owns every policy on the
--    `attachments` bucket. It manages only the KNOWN attachments policy names
--    and creates only the two policies the product needs:
--
--    F1 (policy teardown safety): the original blanket
--    `drop policy on storage.objects` loop was removed. It could destroy
--    policies belonging to OTHER buckets sharing the same Supabase project.
--    A fresh Supabase storage schema ships with NO policies on
--    storage.objects — RLS is deny-by-default — so there is no broad
--    "permissive authenticated fallback" to neutralise; the scoped policies
--    below are the ONLY ones granting access, and unrelated bucket policies
--    are left untouched. Future buckets add their own policies independently.
--
--    F2 (immutable evidence objects): there is deliberately NO UPDATE policy.
--    Evidence is append-only. Replacing evidence uploads a NEW object + NEW
--    attachment_evidence row and marks the previous row superseded_at; the
--    original blob is never mutated. An existing blob cannot be overwritten:
--    UPDATE grants nothing for the bucket, and re-INSERTING an existing path
--    is blocked by the storage.objects (bucket_id, name) unique constraint.
--
--    There is NO DELETE policy: the only removal is the explicit, role-gated,
--    auditable `reclaim_evidence` COMMAND (migration 0078).
--
--    COMPATIBILITY (CI bootstrap): the bucket is created without referencing
--    the legacy storage.buckets."public" column. Supabase CLI applies
--    user-defined migrations BEFORE the built-in storage schema is finalized
--    (supabase/cli #1277), and the "public" column is only added by the later
--    storage migration 0008-add-public-to-buckets — so referencing it here
--    fails with 'ERROR: column "public" of relation "buckets" does not exist'
--    during `supabase start`, breaking `db reset` / `test db` / types-drift.
--    Privacy is NOT lost: the bucket is private via the DB-enforced RLS
--    policies on storage.objects below (no public/anonymous read grant) and
--    the client only ever reads via short-lived signed URLs. The column's
--    default is FALSE, so omitting it yields the same private behaviour.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name)
values ('attachments', 'attachments')
on conflict (id) do nothing;

create or replace function public.install_attachments_storage_policies()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Drop ONLY the known attachments policy names so replay is idempotent.
  drop policy if exists "attachments_select_org_role" on storage.objects;
  drop policy if exists "attachments_insert_org_role" on storage.objects;
  drop policy if exists "attachments_update_org_role" on storage.objects;

  create policy "attachments_select_org_role" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'attachments'
      and public.is_org_member(((storage.foldername(name))[1])::uuid)
      and public.attachment_evidence_read_gate(
            ((storage.foldername(name))[1])::uuid,
            ((storage.foldername(name))[2])::public.attachment_evidence_type
          )
    );

  create policy "attachments_insert_org_role" on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'attachments'
      and public.is_org_member(((storage.foldername(name))[1])::uuid)
      and public.attachment_evidence_write_gate(
            ((storage.foldername(name))[1])::uuid,
            ((storage.foldername(name))[2])::public.attachment_evidence_type
          )
    );
end;
$$;

select public.install_attachments_storage_policies();

-- Internal only: this is invoked by migrations / tests as the migration owner.
revoke all on function public.install_attachments_storage_policies() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Internal link primitive (NOT client-callable). Verifies the uploaded
--    object exists in the private bucket before recording metadata, so a
--    failed/lost upload can never surface as verified evidence.
-- ---------------------------------------------------------------------------
create or replace function public.link_evidence(
  p_org_id uuid,
  p_evidence_type public.attachment_evidence_type,
  p_entity_type text,
  p_entity_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_metadata jsonb default null
)
returns public.attachment_evidence
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attachment_evidence;
  v_tokens text[];
begin
  if p_evidence_type is null or p_entity_type is null or p_entity_id is null then
    raise exception 'EVIDENCE_TARGET_REQUIRED' using errcode = '22023';
  end if;
  if p_storage_path is null or p_file_name is null
     or p_mime_type is null or p_size_bytes is null then
    raise exception 'EVIDENCE_FILE_REQUIRED' using errcode = '22023';
  end if;
  if p_size_bytes <= 0 or p_size_bytes > 5242880 then
    raise exception 'ATTACHMENT_SIZE_EXCEEDED' using errcode = '22023';
  end if;
  if p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf') then
    raise exception 'ATTACHMENT_MIME_NOT_ALLOWED' using errcode = '22023';
  end if;

  -- Path shape: {org}/{evidence_type}/{entity_type}/{file_name}. The entity
  -- linkage lives in the metadata row (entity_type + entity_id), never in the
  -- path, so a client can upload BEFORE the target record's id is known (e.g.
  -- an attendance selfie captured before the punch row is created).
  v_tokens := string_to_array(p_storage_path, '/');
  if array_length(v_tokens, 1) < 4
     or v_tokens[1] <> p_org_id::text
     or v_tokens[2] <> p_evidence_type::text
     or v_tokens[3] <> p_entity_type then
    raise exception 'ATTACHMENT_PATH_INVALID' using errcode = '22023';
  end if;

  -- The uploaded object MUST exist in the private bucket: this is the
  -- "no false success" boundary — a metadata row is never written for a path
  -- that was not actually stored.
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'attachments' and o.name = p_storage_path
  ) then
    raise exception 'ATTACHMENT_OBJECT_MISSING' using errcode = 'P0002';
  end if;

  insert into public.attachment_evidence (
    organization_id, evidence_type, entity_type, entity_id,
    storage_path, file_name, mime_type, size_bytes, uploaded_by, metadata
  ) values (
    p_org_id, p_evidence_type, p_entity_type, p_entity_id,
    p_storage_path, p_file_name, p_mime_type, p_size_bytes, auth.uid(),
    p_metadata
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.link_evidence(uuid, public.attachment_evidence_type, text, uuid, text, text, text, bigint, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. attach_evidence — the client-facing evidence command (role-gated by
--    evidence type). Used for identity documents, receipts and handover
--    proof where the target record already exists.
-- ---------------------------------------------------------------------------
create or replace function public.attach_evidence(
  p_org_id uuid,
  p_evidence_type public.attachment_evidence_type,
  p_entity_type text,
  p_entity_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_supersede boolean default false,
  p_idempotency_key uuid default gen_random_uuid(),
  p_metadata jsonb default null
)
returns public.attachment_evidence
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attachment_evidence;
  v_owner_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.attachment_evidence_write_gate(p_org_id, p_evidence_type) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- The target record must belong to the same organization.
  v_owner_ok := case p_entity_type
    when 'staff_member' then exists (
      select 1 from public.staff_members m
       where m.organization_id = p_org_id and m.id = p_entity_id)
    when 'staff_attendance' then exists (
      select 1 from public.staff_attendance a
       where a.organization_id = p_org_id and a.id = p_entity_id)
    when 'host_payout' then exists (
      select 1 from public.host_payouts p
       where p.organization_id = p_org_id and p.id = p_entity_id)
    when 'event' then exists (
      select 1 from public.events e
       where e.organization_id = p_org_id and e.id = p_entity_id)
    when 'event_equipment_reservation' then exists (
      select 1 from public.event_equipment_reservations r
       where r.organization_id = p_org_id and r.id = p_entity_id)
    when 'event_expense' then exists (
      select 1 from public.event_expenses x
       where x.organization_id = p_org_id and x.id = p_entity_id)
    else false
  end;
  if not v_owner_ok then
    raise exception 'EVIDENCE_TARGET_NOT_IN_ORG' using errcode = '23503';
  end if;

  -- Serialize replaces so a single current attachment is deterministic.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_org_id::text || ':' || p_evidence_type::text || ':' || p_entity_type || ':' || p_entity_id::text, 1
    )
  );

  if p_supersede then
    update public.attachment_evidence
       set superseded_at = now()
     where organization_id = p_org_id
       and evidence_type = p_evidence_type
       and entity_type = p_entity_type
       and entity_id = p_entity_id
       and superseded_at is null;
  end if;

  v_row := public.link_evidence(
    p_org_id, p_evidence_type, p_entity_type, p_entity_id,
    p_storage_path, p_file_name, p_mime_type, p_size_bytes, p_metadata
  );

  perform public.record_audit(
    p_org_id, 'ATTACHMENT_RECORDED', 'attachment_evidence', v_row.id::text,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'evidence_type', p_evidence_type,
      'entity_type', p_entity_type,
      'entity_id', p_entity_id,
      'storage_path', p_storage_path
    )
  );
  return v_row;
end;
$$;

revoke all on function public.attachment_evidence_read_gate(uuid, public.attachment_evidence_type) from public, anon;
revoke all on function public.attachment_evidence_write_gate(uuid, public.attachment_evidence_type) from public, anon;
revoke all on function public.can_view_sensitive_staff_evidence(uuid) from public, anon;
revoke all on function public.can_view_operational_evidence(uuid) from public, anon;
revoke all on function public.can_view_financial_evidence(uuid) from public, anon;
revoke all on function public.attach_evidence(uuid, public.attachment_evidence_type, text, uuid, text, text, text, bigint, boolean, uuid, jsonb)
  from public, anon;

grant execute on function public.attachment_evidence_read_gate(uuid, public.attachment_evidence_type) to authenticated;
grant execute on function public.attachment_evidence_write_gate(uuid, public.attachment_evidence_type) to authenticated;
grant execute on function public.can_view_sensitive_staff_evidence(uuid) to authenticated;
grant execute on function public.can_view_operational_evidence(uuid) to authenticated;
grant execute on function public.can_view_financial_evidence(uuid) to authenticated;
grant execute on function public.attach_evidence(uuid, public.attachment_evidence_type, text, uuid, text, text, text, bigint, boolean, uuid, jsonb) to authenticated;
