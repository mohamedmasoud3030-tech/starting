# Phase 4 — production readiness verification

Baseline: `main@375b31df15e0ccfbeac5574c74a214a45a3544ab`

This report records connected-environment evidence gathered during the Phase 4 product acceptance pass. It distinguishes verified facts from deployment blockers; no unrelated Vercel project was modified.

## Supabase binding — VERIFIED

The connected Supabase project named `starting` is:

- project ref: `livpmxwwxsfnaceczyth`
- API URL: `https://livpmxwwxsfnaceczyth.supabase.co`
- status at verification: `ACTIVE_HEALTHY`

The repository `.env.production` points to that exact project and uses its current public/publishable browser key. Phase 4 also sets `VITE_PUBLIC_DEMO_MODE=false` explicitly; normal Supabase Auth is the production frontend path.

At verification time the database contains one active organization (`شركة الريان للضيافة - Demo`), one Auth user, and one active organization membership. Disabling anonymous demo access therefore does not delete the tenant or its data; it requires the real authenticated account for browser access.

## P0 production posture finding — temporary public demo still active in the database

Frontend demo mode had already been made opt-in, but the database still carried the earlier temporary public-demo capability:

- PostgreSQL role `anon` inherited `public_demo_admin`.
- `public_demo_admin` held broad SELECT/CRUD grants over the demo tenant's browser surfaces and EXECUTE on the application RPC allowlist.
- RLS helper overrides intentionally treated anonymous requests as owner-equivalent only for the named demo organization.
- The Supabase Security Advisor consequently reported many SECURITY DEFINER functions as effectively callable by `anon`.

This means turning the frontend demo flag off was not a complete production teardown: a caller using the public browser key could still reach the database's anonymous demo contract for the demo organization.

### Phase 4 correction

Forward migration `20260817024500_disable_public_demo_access.sql`:

1. revokes `public_demo_admin` membership from `anon`;
2. removes the legacy role's schema/table/sequence/function privileges so an accidental future membership grant cannot revive the old access;
3. leaves authenticated application grants untouched;
4. keeps historical demo migrations and the now-inert role for migration replay/auditability.

`production_demo_teardown.test.sql` proves:

- `anon` no longer inherits the demo role;
- `anon` cannot read/write representative business tables;
- `anon` cannot execute a representative application RPC;
- `authenticated` retains the application RPC and authorization-helper access required by the app.

The migration is committed to the Phase 4 branch and must pass clean replay + pgTAP before merge. It is intentionally not applied out-of-band ahead of repository history.

## Vercel binding — BLOCKED / NOT VERIFIED

The connected Vercel team currently exposes only one project:

- project: `jiwdah`
- project id: `prj_5MgYmjUfT1tjotTgoE2VSqThn6xo`
- domains include `jiwdah.vercel.app`

No Vercel project named or otherwise proven to be `starting` is visible through the connected account. Therefore Phase 4 does **not** modify `jiwdah`, its environment variables, domains, or deployments.

Production deployment remains blocked on connecting or identifying the actual Vercel project for `starting`. Repository and Supabase binding are verified independently; Vercel linkage is not inferred from names or previous preview comments.

## Additional Supabase advisor item

Leaked-password protection is currently reported disabled by Supabase Auth. The available connector does not expose an Auth configuration mutation for that setting, so it remains a platform-setting follow-up rather than being changed indirectly through SQL.

## Product acceptance scope in this PR

- Dashboard rebuilt as an operational command center without changing its DB/query sources of truth.
- Global page/shell hierarchy tightened for professional desktop/tablet/mobile density.
- Customers gain search + active/inactive filtering rather than an unbounded card dump.
- Procurement adopts the shared page hierarchy and denser accessible tabs.
- Events and Quotes were inspected and already had search/filter/list structure; no churn was introduced solely for visual consistency.

No branch/location model is introduced. `Organization` remains one independent tenant/business/office.
