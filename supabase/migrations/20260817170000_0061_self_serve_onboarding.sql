-- Self-serve onboarding (first-organization creation), forward-only.
-- Authenticated users may create their own first organization; anonymous users
-- remain unable to execute the command. The existing RPC derives the caller
-- from auth.uid() and inserts that caller as OWNER of only the new organization.

revoke execute on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

comment on function public.create_organization(text, text) is
  'Self-serve first-organization onboarding: the authenticated caller becomes OWNER of the organization they create.';
