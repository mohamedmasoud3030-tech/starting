# R10 Foundation Closeout

## Control state

- Repository: `mohamedmasoud3030-tech/starting`
- Base: `main@ab29eb6bcd2b45da9cb650a5c980577a611f6e9d`
- Branch: `chatgpt/r10-product-consolidation-foundation`
- Production Supabase project: `livpmxwwxsfnaceczyth`

## Delivered

- Restored production migration `0048_security_advisor_hardening` into repository history to eliminate the pre-existing repo/production drift.
- Consolidated three duplicate physical command replay tables into one canonical `command_idempotency` table.
- Preserved old relation names as read-only compatibility views so existing diagnostics and command contracts continue to work without duplicate storage.
- Preserved historical advisory-lock behaviour and command replay semantics.
- Aligned the repository migration version with the exact production migration version `20260816004050` so future migration tooling does not attempt to replay the already-applied consolidation.
- Regenerated `src/lib/database.types.ts` from a clean Supabase migration replay.
- Added a 12-assertion pgTAP guard preventing the three physical idempotency tables from returning and proving internal-only access.
- Rebuilt `AppShell` navigation around hospitality workflows instead of nine equal top-level module links.
- Added the canonical product consolidation and IA contract in `17-product-consolidation-foundation.md`.

## Production verification

After the production migration:

- `command_idempotency` is a physical table.
- `procurement_command_idempotency`, `payments_command_idempotency`, and `staff_payroll_command_idempotency` are compatibility views.
- RLS is enabled on the canonical register.
- Authenticated users cannot read the canonical register.
- Domain replay helpers remain internal-only.
- Canonical and compatibility replay relations currently contain zero rows, so the consolidation did not discard stored replay facts.

## Final CI evidence

GitHub Actions run: `31919536086`

Frontend job:

- TypeScript typecheck: PASS
- lint: PASS (0 errors)
- Vitest: **36 files / 349 tests PASS**
- production build: PASS
- production smoke proof: PASS
- whitespace check: PASS

Database job:

- clean migration replay: PASS
- pgTAP: **14 files / 554 tests PASS**
- warehouse + consumable concurrency proof: PASS
- consumable catalog/profile concurrency proof: PASS
- procurement concurrency and lifecycle proofs: PASS
- customer payment concurrency proof: PASS
- staff payroll concurrency proof: PASS
- backup -> reset -> restore -> verify proof: PASS
- generated database types: PASS
- committed/generated type drift: **0**

## Intentionally deferred

The Quick Quote subsystem remains a separate editable pre-booking workspace in this change. It is the next consolidation candidate, but merging it into the issued quotation lifecycle must be done as one dedicated refactor covering draft mutability, issue-time immutability, acceptance, Customer/Event conversion, frontend state, RPCs, tests, and migration compatibility together.

The full visual redesign is also intentionally after the canonical domain/IA foundation. This change establishes the navigation structure that the redesign should build on rather than decorating the previous flat module hierarchy.
