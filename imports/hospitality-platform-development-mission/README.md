# Hospitality Platform Development Mission — preserved snapshot

This directory preserves the S1/S2/S3 development snapshot supplied on 2026-08-14 while keeping the hardened Supabase foundation authoritative.

Source attachment: `hospitality-platform-development-mission.zip`

Base branch commit: `9d37da5b843ede51c8b139a4991ce7f32ad29491`

## Safety rule

The snapshot contains useful Event, quotation, staff scheduling, equipment reservation, readiness, Arabic UX and domain logic, but its original execution model used a local in-browser engine / localStorage and a local session provider.

Those prototype persistence/auth pieces MUST NOT replace the production foundation. The production application remains based on:

- Supabase Auth
- PostgreSQL migrations
- RLS
- transactional RPC/server commands
- TanStack Router
- TanStack Query
- OMR 3-decimal money rules
- organization-scoped authorization
- sensitive cost-data separation
- audit controls

## Integration status

This import is intentionally isolated from `src/` and `supabase/`. It is source/reference material for the production port of S1/S2/S3 and does not change runtime behavior by itself.

High-value concepts preserved from the snapshot:

- Event lifecycle: DRAFT → QUOTED → CONFIRMED → PREPARING → DISPATCHED → IN_PROGRESS → RETURNING → CLOSED, plus controlled cancellation
- event pricing-line snapshots
- immutable quotation revisions
- expected revenue/cost/profit separation
- staff compensation snapshots and overlap detection
- reusable-equipment reservation capacity
- cancellation release semantics
- readiness states
- Arabic-first Event workspace UX

Do not merge prototype localStorage/session code into production without replacing persistence and authorization with the real Supabase-backed implementation.