-- ============================================================================
-- SUPPLEMENTARY (Layer A) — minimal storage schema replica for NATIVE PostgreSQL
-- ----------------------------------------------------------------------------
-- This file is used ONLY by scripts/native-db/run.mjs and
-- scripts/native-db/make_types_db.mjs against a local native PostgreSQL
-- instance for early defect detection. It is NOT part of the product
-- migrations and is NOT used by `supabase test db` (Layer B already has the
-- real Supabase `storage` schema).
--
-- It replicates just enough of Supabase's `storage` schema (buckets, objects,
-- foldername/filename/extension helpers) so the private-attachments migration
-- can create storage policies and the evidence-linking commands can verify an
-- uploaded object exists — mirroring what `supabase db reset` provides in CI.
-- ============================================================================

create schema if not exists storage;

grant usage on schema storage to authenticated, anon;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  metadata jsonb,
  constraint storage_objects_bucket_name_unique unique (bucket_id, name)
);

alter table storage.objects enable row level security;

-- Supabase grants the storage API roles table privileges; RLS policies then
-- scope access per object. Replicated here so the native harness mirrors CI.
grant select, insert, update on table storage.objects to authenticated;
grant select, insert, update on table storage.objects to anon;
grant select on table storage.buckets to authenticated, anon;

-- Supabase helpers used by storage RLS policies (mirror of the real ones).
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end;
$$;

create or replace function storage.filename(name text)
returns text
language plpgsql
immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end;
$$;

create or replace function storage.extension(name text)
returns text
language plpgsql
immutable
as $$
declare
  _filename text;
begin
  _filename := storage.filename(name);
  return substring(_filename from '\.([^.]+)$');
end;
$$;
