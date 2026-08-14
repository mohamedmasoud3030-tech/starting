-- ============================================================================
-- SUPPLEMENTARY (Layer A) — minimal auth schema replica for NATIVE PostgreSQL
-- ----------------------------------------------------------------------------
-- This file is used ONLY by scripts/native-db/run.mjs against a local native
-- PostgreSQL instance for early defect detection. It is NOT part of the
-- product migrations and is NOT used by `supabase test db`.
--
-- It replicates just enough of Supabase's `auth` schema (auth.users columns,
-- auth.uid()/auth.role()) so the migrations and pgTAP tests can execute
-- against a plain PostgreSQL server. The authoritative acceptance environment
-- remains the official Supabase stack in CI (Layer B).
-- ============================================================================

-- Supabase roles used by RLS grants.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant anon, authenticated to postgres;

create schema if not exists auth;

create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  confirmation_token text,
  confirmation_sent_at timestamptz,
  recovery_token text,
  recovery_sent_at timestamptz,
  email_change_token_new text,
  email_change text,
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text,
  phone_confirmed_at timestamptz,
  phone_change text,
  phone_change_token text,
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz,
  email_change_token_current text,
  email_change_confirm_status smallint,
  banned_until timestamptz,
  reauthentication_token text,
  reauthentication_sent_at timestamptz,
  is_sso_user boolean,
  deleted_at timestamptz,
  is_anonymous boolean
);

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

-- Match Supabase: authenticated/anon may call auth.uid()/auth.role() and use
-- the auth schema (profiles RLS policies reference auth.uid() directly).
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.role() to anon, authenticated;
