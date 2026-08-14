# 10 — عمليات المخزن S4A: المعدات القابلة لإعادة الاستخدام

> Warehouse Dispatch, Return, Damage & Loss — the physical-equipment control
> layer attached to Events and to the S3 equipment reservations.
>
> **Boundary:** this document is S4A. Consumable stock is S4B and must close
> before the roadmap advances to S5.

## 1. Domain model: ledger + two different quantity meanings

`event_equipment_movements` is an append-only ledger. Event reconciliation is
derived from it:

```text
dispatched    = Σ dispatched_quantity
returned_good = Σ returned_good_quantity
damaged       = Σ damaged_quantity
lost          = Σ lost_quantity
outstanding   = dispatched − returned_good − damaged − lost
```

`outstanding` answers: **has every unit dispatched for this Event been
accounted for?** Damage/loss therefore legitimately reduces Event outstanding.

Physical serviceability is intentionally different:

```text
physically_unavailable = dispatched − returned_good
unserviceable          = damaged + lost
```

A damaged/lost unit is accounted for, but it does **not** reappear as physical
stock. Future availability/reservations subtract unserviceable quantity until a
future audited repair/replacement adjustment explicitly restores capacity.

Reusable equipment and consumables remain separate domains.

## 2. Server-authoritative commands

| RPC | Purpose | Roles |
| --- | --- | --- |
| `dispatch_event_equipment` | Equipment physically leaves the warehouse | OWNER, MANAGER, SUPERVISOR, WAREHOUSE |
| `return_event_equipment` | Good / damaged / lost disposition | OWNER, MANAGER, SUPERVISOR, WAREHOUSE |
| `reconcile_event_warehouse` | Final warehouse closure | OWNER, MANAGER |
| `event_warehouse_summary` | Event operational summary | any member |
| `warehouse_reservation_state` | Derived per-reservation state | any member, org scoped |

Dispatch rejects invalid lifecycle/state, invalid quantities, reservation/Event
mismatch, reservation over-dispatch, physical-capacity over-dispatch, finalised
reconciliation, cross-org access and idempotency mismatch.

Return rejects cumulative good + damaged + lost above actual dispatched
quantity. Returns remain possible for a cancelled Event while physical equipment
is still outstanding.

## 3. Locking and concurrency contract

Warehouse commands use one stable lock order:

1. **Event row** — shared by dispatch, return, cancellation and final reconciliation.
2. **Reservation row** — serializes per-reservation cumulative quantities.
3. **Equipment-capacity row** — serializes different Events/reservations drawing from the same physical pool and damage/loss serviceability changes.

This closes both stale-total races and lock-order deadlocks.

`event_equipment_movements` also has a `BEFORE INSERT` structural guard. It
rechecks the Event reconciliation boundary and the shared physical-capacity
boundary at the data-write edge. The trigger is defense in depth; the RPCs
still acquire locks before making business decisions.

Consequences:

- two sessions cannot over-dispatch one reservation;
- two **different** Events/reservations cannot concurrently exceed the same
  `equipment_capacity` pool;
- dispatch/return cannot land after final reconciliation;
- damage/loss cannot race a future reservation/dispatch and silently recreate
  serviceable stock.

## 4. Idempotency

Dispatch, return and reconciliation store a SHA-256 fingerprint of the canonical
payload under unique `(organization_id, idempotency_key)`.

- same key + same payload → original result;
- same key + different payload → `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`;
- concurrent identical retries re-check idempotency **after waiting on the
  shared Event lock**, so both callers can receive a successful replay while
  only one physical movement and one audit event are created.

## 5. Damage/loss valuation

Damage/loss snapshots catalog cost at disposition time:

- `valuation_basis = CATALOG_COST_SNAPSHOT`
- immutable unit valuation
- immutable extended damage/loss valuation

Later catalog-price changes cannot restate warehouse history.

No GL/journal postings are created in S4A because the repository has no
accounting posting contract yet. S4A persists the operational/valuation facts a
future accounting slice will need.

## 6. Final reconciliation

`event_warehouse_reconciliations` contains at most one append-only row per
Event.

- reconciliation fails while `outstanding > 0`;
- its CHECK constraint independently requires
  `dispatched = returned_good + damaged + lost`;
- movement commands and reconciliation share the Event lock, so a concurrent
  dispatch/return cannot appear immediately after closure;
- once reconciled, later movements are rejected.

An audited correction/reversal mechanism is deliberately deferred rather than
providing an unaudited escape hatch.

## 7. Cancellation and manual release

Cancellation/release may never erase a physical recovery obligation.

- reservation with current `outstanding > 0` remains ACTIVE even if Event is cancelled;
- reservation whose current `outstanding = 0` may be cancelled/released, even
  if it was dispatched earlier;
- manual `release_equipment_reservation` rejects with
  `RESERVATION_HAS_OUTSTANDING_EQUIPMENT` while stock is still outstanding.

This replaces the earlier “ever dispatched” rule with the authoritative **current
outstanding** rule.

## 8. Security

- RLS on both warehouse business tables;
- client roles have SELECT only; writes go through RPCs;
- UPDATE/DELETE on the movement ledger are rejected by append-only trigger;
- tenant-safe composite FKs prevent cross-org references structurally;
- SECURITY DEFINER functions pin `search_path = ''`;
- actor comes from `auth.uid()`, never client input;
- WAREHOUSE can perform physical operations but cannot read cost/valuation;
- final reconciliation is OWNER/MANAGER only.

`event_warehouse_lines` contains operational quantities. The valued read model
is cost-gated. Warehouse audit payloads deliberately omit valuation.

## 9. Verification strategy

CI runs the database acceptance chain on the official Supabase local stack:

1. clean migration replay;
2. full pgTAP suite;
3. **real two-session warehouse concurrency harness**;
4. generated Supabase TypeScript types;
5. strict committed-vs-generated type drift comparison.

The two-session harness is a required CI gate and genuinely interleaves:

1. same-reservation over-dispatch;
2. same-reservation over-return;
3. concurrent identical idempotent replay;
4. different Events/reservations sharing one physical-capacity row;
5. dispatch racing final reconciliation on the same Event.

pgTAP additionally locks the structural invariants, role/RLS boundaries,
damage/loss serviceability, cancellation/release behavior, valuation snapshots
and idempotency semantics.

Frontend tests cover operator states, blocked flows, Arabic error translation,
commercial separation, reconciliation confirmation and prevention of raw
UUID/SQL leakage.

## 10. Operator UX

The Event warehouse tab (`المخزن`) exposes per line:

`المطلوب تجهيزه`, `المحجوز`, `تم صرفه`, `تم إرجاعه`, `تالف`, `مفقود`,
`متبقي بالخارج`, plus Event-level reconciliation state.

The interaction is Arabic/RTL first, with large touch targets, quantity steppers,
one-tap common actions, explicit blocked reasons and confirmation before final
reconciliation.

## Explicitly deferred

- **S4B consumable stock** — ✅ delivered; see
  [11-consumable-inventory.md](11-consumable-inventory.md);
- accounting postings for damage/loss;
- warehouse/location dimension;
- audited repair/replacement capacity restoration;
- audited correction/reversal of a final reconciliation.
