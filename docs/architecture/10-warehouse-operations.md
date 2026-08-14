# 10 — عمليات المخزن (S4): الصرف، الإرجاع، التالف والمفقود، التسوية

> Warehouse Dispatch, Return, Damage & Loss — the physical-equipment control
> layer attached to Events and to the S3 equipment reservations.

## 1. Domain model: a ledger, not a status field

The physical state of an Event's equipment is **derived**, never stored as a
mutable counter or status flag.

`event_equipment_movements` is an **append-only ledger** of authoritative
physical movements. Everything the operator and the invariants need is
recomputed from it:

```
dispatched    = Σ dispatched_quantity        (DISPATCH rows)
returned_good = Σ returned_good_quantity     (RETURN rows)
damaged       = Σ damaged_quantity           (RETURN rows)
lost          = Σ lost_quantity              (RETURN rows)
outstanding   = dispatched − returned_good − damaged − lost
```

Why not a status column:

- a flag cannot express partial dispatch, multiple truck loads, partial
  returns, or a mixed good/damaged/lost disposition;
- a stored counter can be silently corrected and is not auditable;
- a ledger makes `outstanding` a provable invariant instead of a stored guess.

`public.warehouse_reservation_state(org, reservation)` is the single derivation
point. Every command and both read models call it, so there is exactly one
definition of "outstanding" in the system.

### Lifecycle

```
reservation (S3) → dispatch → [partial | full] return
                            → damage / loss recording
                            → final reconciliation (closure)
```

## 2. Commands (server-authoritative)

| RPC | Purpose | Roles |
| --- | --- | --- |
| `dispatch_event_equipment` | Equipment physically leaves the warehouse | OWNER, MANAGER, SUPERVISOR, WAREHOUSE |
| `return_event_equipment` | Account for stock coming back: good / damaged / lost | OWNER, MANAGER, SUPERVISOR, WAREHOUSE |
| `reconcile_event_warehouse` | Final, irreversible warehouse closure | OWNER, MANAGER |
| `event_warehouse_summary` | Event-level operator summary (no valuation) | any member |
| `warehouse_reservation_state` | Derived per-line state | any member (self-scoped) |

`WAREHOUSE` owns every physical action it legitimately performs, and **no**
commercial cost visibility. Final reconciliation freezes damage/loss valuation
and is therefore a commercial act restricted to OWNER/MANAGER.

### Rejections

`dispatch_event_equipment` rejects: unauthenticated callers, unauthorized
roles, cross-organization access, unknown/invalid reservation or Event,
reservation belonging to a different Event, inactive reservation, zero or
negative quantity, dispatch above the remaining reservation, dispatch above
physical capacity (units still in the field elsewhere), a non-dispatchable
Event lifecycle state, an already-reconciled Event, and an idempotency key
replayed with a different payload.

`return_event_equipment` additionally rejects any return whose cumulative
good + damaged + lost would exceed what was actually dispatched.

## 3. Damage, loss, and the valuation boundary

Damage and loss are **first-class quantities**, not notes.

When damage or loss is recorded, the command snapshots the catalog cost into
the movement row as an **immutable valuation basis**:

- `valuation_basis` = `CATALOG_COST_SNAPSHOT`
- `unit_valuation_omr` — the cost at the moment of the event
- `damage_loss_valuation_omr` — `round(unit × (damaged + lost), 3)`

A later change to `catalog_items.cost_price` can never restate a historical
damage/loss value. This is the same snapshot invariant S2 applies to pricing,
and it is covered by an explicit regression test.

All money is exact `numeric(*,3)` in the database and integer milli-OMR in the
frontend through `src/lib/money.ts`. No binary float is ever a financial source
of truth.

### Explicitly deferred: accounting recognition

This slice creates **no accounting postings**. The current architecture defines
no accounting posting contract — there is no journal, GL, or posting table, and
inventing one here would be speculative. S4 therefore records exactly the
operational and valuation facts a future accounting slice needs to post from
(basis, unit valuation, extended valuation, quantities, Event, actor, time),
and stops at that boundary.

## 4. Reconciliation

`event_warehouse_reconciliations` holds at most **one** row per Event and is
append-only.

- Reconciliation is **impossible while any dispatched quantity is
  outstanding** (`WAREHOUSE_OUTSTANDING_QUANTITY`), enforced by re-deriving
  from the ledger under an Event row lock.
- A `CHECK` constraint independently requires
  `dispatched = returned_good + damaged + lost`, so even a privileged write
  cannot persist an unbalanced closure.
- Once reconciled, dispatch and return are both rejected
  (`WAREHOUSE_ALREADY_RECONCILED`), so a finalized reconciliation cannot be
  invalidated by later movement.
- There is deliberately **no correction mechanism** in this slice: the
  architecture has no audited correction/reversal contract yet, and adding an
  unaudited escape hatch would defeat the guarantee. A correction slice must
  introduce an explicit, audited reversal command.

## 5. Cancellation interaction (S3 defect repaired)

The S3 `cancel_event()` flipped **every** ACTIVE reservation to CANCELLED.
Once physical dispatch exists, that is unsafe: it would "release" equipment
sitting in a venue, erasing the obligation to bring it back.

Repaired forward-only in `0022`:

- reservations with **no** dispatched quantity are released as before;
- reservations with dispatched quantity stay **ACTIVE and outstanding**;
- returns are still accepted for a CANCELLED Event, so the stock can be
  brought back and the Event reconciled through authoritative commands.

The audit payload records both `equipment_released` and
`equipment_retained_dispatched`.

## 6. Security

- RLS is enabled on both new tables.
- Neither table has an INSERT/UPDATE/DELETE policy, and clients are granted
  `SELECT` only: the RPCs are the sole write path.
- Append-only triggers reject UPDATE/DELETE on both tables, so even a
  privileged path cannot rewrite physical history.
- All composite FKs are `(organization_id, id)`, making a cross-organization
  reference structurally impossible independent of RLS. S3's
  `event_equipment_reservations` lacked the `(organization_id, id)` unique key
  this requires; `0020` adds it (purely additive).
- Every SECURITY DEFINER function pins `search_path = ''`.
- `EXECUTE` is revoked from `public`/`anon` on every command.
- The actor is always `auth.uid()`; no command accepts a client-supplied user id.

### Commercial separation at the data boundary

| Read model | Audience | Contains |
| --- | --- | --- |
| `event_warehouse_lines` | every member, incl. WAREHOUSE | quantities only |
| `event_warehouse_lines_valued` | `can_read_cost()` only | + immutable valuation |

The valuation-bearing base table is itself gated by `can_read_cost()`. Audit
payloads carry operational quantities only — no valuation — so cost cannot leak
through the audit channel either.

## 7. Idempotency and concurrency

Every command takes an `p_idempotency_key` and stores a
`request_fingerprint` — a SHA-256 over the canonical business payload:

- same org + same key + **same** payload → the original row is returned, with
  no second movement and no second audit event;
- same org + same key + **different** payload → hard rejection
  (`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`, SQLSTATE 22023).

A `UNIQUE (organization_id, idempotency_key)` constraint makes a duplicate row
impossible even under a lost-update race.

Concurrency safety is structural: each command takes
`SELECT … FOR UPDATE` on the reservation (or Event) row **before** summing the
ledger, so a competing transaction blocks rather than reading a stale total.
Two concurrent dispatches therefore serialize and the loser correctly fails the
reservation invariant.

## 8. Test strategy

| Layer | File | Coverage |
| --- | --- | --- |
| pgTAP | `supabase/tests/warehouse_dispatch.test.sql` | 97 assertions: isolation, role matrix, cross-org rejection, dispatch validation, partial/multiple returns, damage, loss, mixed, over-return, outstanding, reconciliation, idempotency, audit, valuation immutability, cancellation |
| pgTAP | `supabase/tests/warehouse_concurrency.test.sql` | 9 assertions: lock ordering, unique-constraint protection, serialized outcome, physical capacity |
| Node (2 sessions) | `scripts/native-db/warehouse_concurrency.mjs` | true interleaved races: over-dispatch, over-return, idempotent replay |
| Vitest | `src/features/warehouse/warehouse.model.test.ts` | 32 tests: nullability policy, role matrix, blocked states, quantity guards, error translation |
| Vitest | `src/features/warehouse/WarehousePanel.test.tsx` | 21 tests: operator states, blocked flows, confirmation, commercial separation, no UUID/no raw SQL leakage |

pgTAP runs inside a single transaction and cannot interleave sessions, so the
two-session harness exists to prove empirically what pgTAP can only prove
structurally. The authoritative gate remains `supabase test db` in CI.

## 9. Operator UX

The warehouse tab (`المخزن`) in the Event workspace shows, per line:
`المطلوب تجهيزه`, `المحجوز`, `تم صرفه`, `تم إرجاعه`, `تالف`, `مفقود`,
`متبقي بالخارج`, plus the Event-level `حالة التسوية`.

Built for a phone or tablet on a warehouse floor: large tap targets, `+/−`
steppers so the common case needs no typing, one-tap "صرف الكل" / "إرجاع الكل",
every disabled control states its reason in Arabic, no raw UUIDs, no PostgreSQL
error text, and an explicit confirmation before the irreversible reconciliation.
