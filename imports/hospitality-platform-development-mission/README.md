# Hospitality Platform Development Mission — preserved snapshot

This directory preserves the S1/S2/S3 development snapshot supplied on 2026-08-14 while keeping the hardened Supabase foundation authoritative.

Source attachment: `hospitality-platform-development-mission.zip`

Source ZIP SHA-256:

`a98a011a879edcafa9683227279b0d24061d3b09e5ee7e14437b8bf2ff4e756c`

Base Foundation commit:

`9d37da5b843ede51c8b139a4991ce7f32ad29491`

## Safety rule

The snapshot contains substantial Event, quotation, staff scheduling, equipment reservation, readiness, Arabic UX and domain work, but its original execution model used a local in-browser engine / `localStorage` and a local session provider.

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

This import is intentionally isolated from production `src/` and `supabase/`. It is source/reference material for the production port of S1/S2/S3 and does not change runtime behavior by itself.

High-value concepts preserved from the snapshot:

- Event lifecycle: DRAFT → QUOTED → CONFIRMED → PREPARING → DISPATCHED → IN_PROGRESS → RETURNING → CLOSED, plus controlled cancellation
- Event list + new-event flow + Event workspace UX
- event pricing-line snapshots
- immutable quotation revisions
- expected revenue/cost/profit separation
- staff directory, compensation snapshots and overlap detection
- reusable-equipment reservation capacity
- cancellation release semantics
- readiness states
- Arabic-first operational UX
- role/permission matrix and machine-readable domain errors

## Preserved source

Directly preserved under this import tree:

- `docs/architecture/07-s1-s2-s3.md`
- `src/engine/types.ts`
- `src/engine/pricingMath.ts`
- `src/lib/domain.ts`
- `src/lib/errors.ts`
- `src/app/session.tsx` — reference only; **must not become production auth**
- `src/features/events/EventsPage.tsx`
- `src/features/events/NewEventPage.tsx`
- `src/features/staff/StaffPage.tsx`
- `src/features/equipment/EquipmentPage.tsx`

Large files are preserved as exact ordered line fragments:

- `fragments/EventWorkspace.tsx.part01`
- `fragments/EventWorkspace.tsx.part02`
- `fragments/EventWorkspace.tsx.part03`
- `fragments/engine.ts.part01`
- `fragments/engine.ts.part02`
- `fragments/engine.ts.part03`
- `fragments/engine.ts.part04`

Reconstruct either source file by concatenating its parts in numeric order, for example:

```bash
cat fragments/engine.ts.part01 \
    fragments/engine.ts.part02 \
    fragments/engine.ts.part03 \
    fragments/engine.ts.part04 > engine.ts
```

The complete original ZIP file inventory and SHA-256 values are recorded in `MANIFEST.sha256`, so future ports can verify source provenance and detect accidental edits.

## Explicitly not activated

The localStorage state engine, demo/local role switching and seed/demo behavior are preserved only as reference concepts. They are not wired into the production application.

The production port must translate the useful domain operations into new PostgreSQL migrations, RLS policies, constraints and transactional RPCs, then expose them through the existing TanStack Query/Router architecture.

Do not merge prototype localStorage/session code into production without replacing persistence and authorization with the real Supabase-backed implementation.
