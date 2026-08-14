# GitHub Actions workflow installation status

On 2026-08-14, the prepared workflow from `docs/ci/ci.yml` was copied to `.github/workflows/ci.yml` and a push was attempted from the fixed Arena branch.

GitHub rejected the push with this exact remote error:

```text
refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission
```

The GitHub Actions permissions API was also unavailable to this integration (`HTTP 403 Resource not accessible by integration`). To allow the production code and migrations to be reviewed on the stacked branch, the active workflow copy was removed from the pushed history; the prepared workflow remains unchanged at `docs/ci/ci.yml` for a repository administrator to install.

Consequences:

- Official `supabase start`, `supabase db reset`, `supabase test db`, and generated-type drift acceptance remain externally blocked.
- Local application gates are still run and reported, but are not a substitute for official Supabase evidence.
- `src/lib/database.types.ts` must not be claimed current until the prepared workflow generates and verifies it against the replayed schema.
