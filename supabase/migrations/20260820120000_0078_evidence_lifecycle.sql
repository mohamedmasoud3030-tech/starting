-- ============================================================================
-- 0078 — Evidence lifecycle: identification ONLY (no blob deletion in the DB)
--
-- F3. PostgreSQL is responsible SOLELY for safely IDENTIFYING private-bucket
-- evidence objects eligible for reclamation. It never deletes storage.objects
-- rows directly. storage.objects is Storage METADATA managed by the Supabase
-- Storage service, not the authoritative blob-deletion API: deleting that row
-- here would not reclaim the underlying bytes and could leave the storage
-- service's view inconsistent. Actual physical deletion must go through the
-- supported Supabase Storage API (the removal endpoint, which also clears the
-- storage.objects metadata row).
--
-- This is a two-phase, explicit, auditable design:
--
--   1) reclaim_evidence(org, max_age_days)            == SURVEY (non-destructive)
--        Identifies + returns candidate objects for THIS org: org-scoped,
--        OWNER/MANAGER-gated, superseded/unreferenced only, age/retention
--        constrained, NEVER able to select a currently-referenced (non-
--        superseded) canonical evidence object. It deletes nothing.
--
--   2) complete_evidence_reclaim(org, paths, max_age_days)  == FINALIZE
--        Called by a privileged SERVER-SIDE caller AFTER it has deleted the
--        objects through the Supabase Storage API. FINALIZE only:
--          * re-derives eligibility (org-scoped, unreferenced, past retention);
--          * refuses any path that is still currently referenced;
--          * VERIFIES the storage.objects metadata row is actually GONE, i.e.
--            the Storage deletion truly succeeded. If any object row is still
--            present, it raises EVIDENCE_STILL_PRESENT and stamps NOTHING — a
--            failed or unfinished physical deletion can never be represented as
--            a successful reclamation;
--          * only after verification stamps lifecycle (reclaimed_at) + audit.
--
-- There is no Edge Function and no service-role key in this repository, and we
-- do not expose a service-role key to the browser. The Storage-API deletion
-- step is intentionally the caller's responsibility and is kept OUT of the
-- data layer; this migration provides only the DB primitives.
-- ============================================================================

alter table public.attachment_evidence
  add column reclaimed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Eligible candidate set, shared by survey and finalize. Returns bucket, object
-- id, path and reason for THIS org only, satisfaction retention, and can never
-- select a currently-referenced (non-superseded) object. INTERNAL — not
-- client-callable.
-- ---------------------------------------------------------------------------
create or replace function public.reclaim_evidence_candidates(
  p_org_id uuid,
  p_cutoff timestamptz
)
returns table (
  bucket_id text,
  object_id uuid,
  storage_path text,
  evidence_type public.attachment_evidence_type,
  entity_type text,
  entity_id uuid,
  reason text,
  object_created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- (a) ORPHAN blobs: stored in this org's bucket, referenced by no metadata row.
  select o.bucket_id::text,
         o.id::uuid,
         o.name::text,
         null::public.attachment_evidence_type,
         null::text,
         null::uuid,
         'ORPHAN'::text,
         o.created_at::timestamptz
    from storage.objects o
   where o.bucket_id = 'attachments'
     and ((storage.foldername(o.name))[1])::uuid = p_org_id
     and o.created_at < p_cutoff
     and not exists (
       select 1 from public.attachment_evidence e
        where e.organization_id = p_org_id and e.storage_path = o.name
     )
  union all
  -- (b) SUPERSEDED blobs: replaced via supersede=true and now past retention.
  --     The metadata row is retained (audit trail); only the object is a
  --     candidate, and it is stamped reclaimed_at by finalize afterwards.
  select o.bucket_id::text,
         o.id::uuid,
         e.storage_path::text,
         e.evidence_type,
         e.entity_type,
         e.entity_id,
         'SUPERSEDED'::text,
         o.created_at::timestamptz
    from public.attachment_evidence e
    join storage.objects o
      on o.bucket_id = 'attachments' and o.name = e.storage_path
   where e.organization_id = p_org_id
     and e.superseded_at is not null
     and e.reclaimed_at is null
     and e.superseded_at < p_cutoff;
$$;

-- INTERNAL ONLY: the two commands below perform their own role gate and call
-- this as the function owner. It is never granted to clients.
revoke all on function public.reclaim_evidence_candidates(uuid, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) SURVEY — non-destructive identification (OWNER/MANAGER of the org only).
-- ---------------------------------------------------------------------------
create or replace function public.reclaim_evidence(
  p_org_id uuid,
  p_max_age_days integer default 90
)
returns table (
  bucket_id text,
  object_id uuid,
  storage_path text,
  evidence_type public.attachment_evidence_type,
  entity_type text,
  entity_id uuid,
  reason text,
  object_created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_paths text[];
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_max_age_days is null or p_max_age_days < 0 then
    raise exception 'INVALID_MAX_AGE' using errcode = '22023';
  end if;

  v_cutoff := now() - make_interval(days => p_max_age_days);

  select coalesce(array_agg(c.storage_path), '{}') into v_paths
    from public.reclaim_evidence_candidates(p_org_id, v_cutoff) c;

  perform public.record_audit(
    p_org_id,
    'EVIDENCE_RECLAIM_SURVEYED',
    'attachment_evidence',
    '',
    jsonb_build_object(
      'max_age_days', p_max_age_days,
      'candidate_count', coalesce(cardinality(v_paths), 0),
      'storage_paths', coalesce(v_paths, '{}')
    )
  );

  return query
    select c.bucket_id, c.object_id, c.storage_path, c.evidence_type,
           c.entity_type, c.entity_id, c.reason, c.object_created_at
      from public.reclaim_evidence_candidates(p_org_id, v_cutoff) c
     order by c.storage_path;
end;
$$;

revoke all on function public.reclaim_evidence(uuid, integer) from public, anon;
grant execute on function public.reclaim_evidence(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) FINALIZE — call AFTER the Storage-API deletion succeeded. Re-derives
--    eligibility, verifies the metadata row is gone, then stamps + audits.
-- ---------------------------------------------------------------------------
create or replace function public.complete_evidence_reclaim(
  p_org_id uuid,
  p_storage_paths text[],
  p_max_age_days integer default 90
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.has_org_role(p_org_id, array['OWNER'::public.app_role, 'MANAGER'::public.app_role]) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_max_age_days is null or p_max_age_days < 0 then
    raise exception 'INVALID_MAX_AGE' using errcode = '22023';
  end if;
  if p_storage_paths is null or cardinality(p_storage_paths) = 0 then
    raise exception 'NO_PATHS_PROVIDED' using errcode = '22023';
  end if;

  v_cutoff := now() - make_interval(days => p_max_age_days);

  -- Every path must belong to this org's bucket prefix.
  if exists (
    select 1 from unnest(p_storage_paths) as p(sp)
     where sp is null or split_part(sp, '/', 1) <> p_org_id::text
  ) then
    raise exception 'EVIDENCE_PATH_NOT_IN_ORG' using errcode = '23503';
  end if;

  -- Finalize can NEVER touch a currently-referenced (non-superseded) object.
  -- Eligibility is re-derived from the PERSISTED METADATA (not storage.objects,
  -- whose rows the Storage deletion has already removed): an object is
  -- reclaimable only if its metadata row is superseded and past retention.
  if exists (
    select 1 from public.attachment_evidence e
     where e.organization_id = p_org_id
       and e.superseded_at is null
       and e.storage_path = any(p_storage_paths)
  ) then
    raise exception 'EVIDENCE_REFERENCED' using errcode = '23503';
  end if;

  -- A superseded metadata row that is NOT yet past retention cannot be
  -- finalized (retention window still respected). Paths with NO metadata row
  -- (orphans) are acceptable here and are proven deleted by the check below.
  if exists (
    select 1 from public.attachment_evidence e
     where e.organization_id = p_org_id
       and e.superseded_at is not null
       and e.storage_path = any(p_storage_paths)
       and e.superseded_at >= v_cutoff
  ) then
    raise exception 'EVIDENCE_NOT_ELIGIBLE' using errcode = '22023';
  end if;

  -- VERIFY physical deletion succeeded: the Storage-API removal clears the
  -- storage.objects metadata row. If any object row is STILL present the
  -- deletion is unfinished — finalize nothing (no false reclaim success).
  if exists (
    select 1 from storage.objects o
     where o.bucket_id = 'attachments'
       and o.name = any(p_storage_paths)
  ) then
    raise exception 'EVIDENCE_STILL_PRESENT' using errcode = 'P0002';
  end if;

  -- Stamp lifecycle on the superseded metadata rows (retaining them as the
  -- audit trail). Orphans have no metadata row; they are only audited.
  update public.attachment_evidence e
     set reclaimed_at = now()
   where e.organization_id = p_org_id
     and e.superseded_at is not null
     and e.reclaimed_at is null
     and e.storage_path = any(p_storage_paths);
  get diagnostics v_total = row_count;

  perform public.record_audit(
    p_org_id,
    'EVIDENCE_RECLAIMED',
    'attachment_evidence',
    '',
    jsonb_build_object(
      'max_age_days', p_max_age_days,
      'storage_path_count', cardinality(p_storage_paths),
      'storage_paths', p_storage_paths,
      'metadata_rows_stamped', v_total
    )
  );

  return cardinality(p_storage_paths);
end;
$$;

revoke all on function public.complete_evidence_reclaim(uuid, text[], integer) from public, anon;
grant execute on function public.complete_evidence_reclaim(uuid, text[], integer) to authenticated;
