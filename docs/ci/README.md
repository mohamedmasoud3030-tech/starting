# CI

The authoritative acceptance gate is installed and running at
`.github/workflows/ci.yml`. There is no longer any mirrored copy under
`docs/ci/`: the workflow file itself is the single source of truth.

## Jobs

**Frontend (typecheck, lint, test, build)**

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check` (whitespace)

**Database (Supabase replay, pgTAP, types drift)**

- `supabase start`
- `supabase db reset` — replays every migration from a clean database
- `supabase test db` — the authoritative pgTAP suite
- `supabase gen types typescript --local --schema public`
- fails if the committed `src/lib/database.types.ts` differs from that output

## Generated types

`src/lib/database.types.ts` is **generator-owned**. Never hand-edit it: the
drift gate compares it byte-for-byte against the generator output, and any
manual edit will fail CI.

Application-facing aliases (`AppRole`, `CatalogItemRow`, `PricingMethod`, …)
live in the hand-written `src/lib/dbTypes.ts`, which derives them from the
generated `Database` type. Import application types from `@/lib/dbTypes`.

To refresh the types locally (requires Docker):

```bash
supabase start
supabase db reset
supabase gen types typescript --local --schema public > src/lib/database.types.ts
```

Formatting note: the generator formats its output with the prettier version
bundled in the `supabase/postgres-meta` image. A different local prettier can
reformat unions and conditional types and cause spurious drift, so always take
the file from the command above rather than reformatting it.

## Historical note

An earlier session could not install this workflow because the automated push
token lacked the GitHub App `workflows` permission, and documented that as a
permanent blocker. That blocker was resolved at repository level: the workflow
now exists and the full Supabase stack (migration replay, pgTAP, type
generation) runs successfully in GitHub Actions. Any older document claiming
"CI cannot be installed" or "Supabase cannot run in CI" is obsolete.
