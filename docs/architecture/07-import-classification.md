# S1–S3 preserved snapshot classification

The S1/S2/S3 snapshot previously lived under `imports/hospitality-platform-development-mission/`. It was reference/reconstruction material only: nothing in `src/`, `supabase/`, `scripts/`, `.github/`, tests, or the build depended on it, and the production bundle never imported it. On 2026-08-16 the physical snapshot was **removed from the production repository** (its ZIP SHA-256 was `a98a011a879edcafa9683227279b0d24061d3b09e5ee7e14437b8bf2ff4e756c`, base commit `9d37da5b843ede51c8b139a4991ce7f32ad29491`). This table is the durable classification record of what was reused, adapted, or ported. “Reuse” means documentation/domain semantics were retained; “Adapt” means UX ideas were rebuilt with the Foundation design system; “Port to server” means prototype behavior became PostgreSQL/RPC logic.

| Imported file | Classification | Production disposition |
|---|---|---|
| `MANIFEST.sha256` | REUSE | Integrity record retained unchanged. |
| `README.md` | REUSE | Provenance and reconstruction instructions retained. |
| `docs/architecture/07-s1-s2-s3.md` | REUSE | Lifecycle, permission and snapshot semantics used as design input. |
| `fragments/EventWorkspace.tsx.part01` | ADAPT | Workspace information architecture rebuilt in `src/features/events/EventWorkspace.tsx`. |
| `fragments/EventWorkspace.tsx.part02` | ADAPT | Commercial/team/equipment interactions rebuilt against TanStack Query. |
| `fragments/EventWorkspace.tsx.part03` | ADAPT | Readiness/history/cancellation UX rebuilt against RPCs. |
| `fragments/engine.ts.part01` | PORT TO SERVER | Event and commercial commands moved to migrations `0012`–`0013`. |
| `fragments/engine.ts.part02` | PORT TO SERVER | Quote snapshot/revision behavior moved to PostgreSQL transactions. |
| `fragments/engine.ts.part03` | PORT TO SERVER | Staff overlap and equipment capacity moved to constraints/locking RPCs. |
| `fragments/engine.ts.part04` | PORT TO SERVER | Cancellation/readiness/audit moved to server commands. |
| `src/app/session.tsx` | DISCARD | Fake/local session is forbidden; Foundation Supabase Auth remains authoritative. |
| `src/engine/pricingMath.ts` | PORT TO SERVER | Formula ported to `commercial_total`; OMR arithmetic remains `numeric(...,3)`. |
| `src/engine/types.ts` | PORT TO SERVER | Useful entities became organization-scoped PostgreSQL tables; local `AppState` discarded. |
| `src/features/equipment/EquipmentPage.tsx` | ADAPT | Reservation interaction adapted into the real Event workspace; local persistence discarded. |
| `src/features/events/EventsPage.tsx` | ADAPT | Arabic list/card patterns adapted to TanStack Router/Query. |
| `src/features/events/NewEventPage.tsx` | ADAPT | Form fields adapted into the working create dialog and `create_event` RPC. |
| `src/features/staff/StaffPage.tsx` | ADAPT | Assignment UX adapted into Event workspace; prototype store discarded. |
| `src/lib/domain.ts` | REUSE | Labels/status concepts reused where consistent with Foundation authority. |
| `src/lib/errors.ts` | ADAPT | Machine codes retained at DB boundary and mapped to Arabic UI messages. |

No snapshot source is compiled into production, and no `localStorage` or fake session path was ported. Removal of the physical snapshot is safe: the classification above plus the `docs/architecture/` series capture every concept the snapshot contributed.
