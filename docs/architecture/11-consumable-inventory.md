# 11 — مخزون المواد الاستهلاكية S4B

> Consumable stock ledger & Event consumption — the quantity-truth layer for
> coffee, tea, dates, sugar, water, tissues, charcoal, incense, disposable
> cups, cleaning materials and every other `catalog_item_type = CONSUMABLE`.
>
> **Boundary:** S4B closes S4. Suppliers/catering/procurement are S5 and are
> NOT in this slice.

## 1. Domain model: one append-only quantity ledger, two balances

Consumables are a **quantity ledger**, not a time-window reservation. They are
never modelled through the S4A reusable-equipment tables.

`consumable_movements` is append-only. There is **no mutable
current_quantity column anywhere**; both balances derive from immutable
movements via GENERATED delta columns:

```text
warehouse_on_hand(item)        = Σ warehouse_delta
event_outstanding(event,item)  = Σ event_delta
                               = issued − returned − consumed − event_waste
```

| movement kind       | warehouse | Event custody | notes |
| ------------------- | --------- | ------------- | ----- |
| `RECEIVE`           | +q        | —             | physical receipt only; S5 supplier receipts will link here |
| `ISSUE_TO_EVENT`    | −q        | +q            | rejects shortage transactionally |
| `RETURN_FROM_EVENT` | +q        | −q            | only USABLE stock re-enters the warehouse |
| `CONSUME_AT_EVENT`  | —         | −q            | stock already left at issue; never double-decrements |
| `WASTE_AT_EVENT`    | —         | −q            | never recreates warehouse stock |
| `WAREHOUSE_WASTE`   | −q        | —             | requires a reason (≥ 3 chars, CHECK-enforced) |
| `ADJUSTMENT`        | ±q signed | —             | OWNER/MANAGER, reason required, result never negative |

Both balances are enforced `>= 0` **by the database**: every command re-derives
the balance after acquiring row locks, and a structural `BEFORE INSERT` guard
on the ledger re-checks the same invariants at the data-write edge (defense in
depth against any future privileged write path).

`ADJUSTMENT` covers opening balances and verified count corrections. It cannot
touch Event custody, requires an explicit reason, is fully audited, and is not
a generic escape hatch.

## 2. Exact quantity model

Consumables use fractional units (كجم، لتر، كرتون، صندوق، قطعة). The exact
precision is **`numeric(12,3)`** — the same 3-decimal exact boundary already
authoritative for money and event-line quantities.

- PostgreSQL `numeric` is the arithmetic authority;
- frontend input normalizes decimal text through the existing
  `parseQuantityMilli` integer milli-unit model (no new arithmetic model);
- commands **reject** (never round) more than 3 decimals
  (`QUANTITY_PRECISION_EXCEEDED`), zero/negative operational quantities and
  out-of-range magnitudes;
- cumulative sums are exact `numeric` sums; no binary floating point is ever
  an inventory truth (the JSON `number` transport is proven lossless by
  `toDbNumeric` before send).

## 3. Server-authoritative commands

| RPC | Purpose | Roles |
| --- | --- | --- |
| `save_consumable_stock_item` | Activate/edit tracking + minimum threshold | OWNER, MANAGER |
| `receive_consumable_stock` | Physical warehouse receipt | OWNER, MANAGER, SUPERVISOR, WAREHOUSE |
| `issue_consumable_to_event` | Warehouse −q, custody +q | OWNER, MANAGER, SUPERVISOR, WAREHOUSE |
| `return_consumable_from_event` | Usable stock back to warehouse | OWNER, MANAGER, SUPERVISOR, WAREHOUSE |
| `consume_consumable_at_event` | Actual consumption | OWNER, MANAGER, SUPERVISOR, WAREHOUSE |
| `waste_consumable_at_event` | Event waste/spoilage | OWNER, MANAGER, SUPERVISOR, WAREHOUSE |
| `waste_consumable_stock` | Warehouse waste, reason required | OWNER, MANAGER, SUPERVISOR, WAREHOUSE |
| `adjust_consumable_stock` | Signed audited correction | OWNER, MANAGER |
| `reconcile_event_consumables` | Final Event consumable closeout | OWNER, MANAGER |
| `event_consumable_summary` | Event rollup (status badge) | any member |

The stock profile (`consumable_stock_items`) references the catalog item via a
composite same-org FK; a non-CONSUMABLE item is structurally rejected
(trigger + command check), and a tracked item can never be re-typed away from
CONSUMABLE. Catalog name/unit are **not** duplicated into a second master
table.

## 4. Locking and concurrency contract

One stable lock order across every path:

1. **Event row** — custody movements, final reconciliation, and
   `cancel_event()` all serialize here first.
2. **Consumable stock-item row** — every warehouse-balance change of one item
   serializes here, across Events and warehouse-only commands.

Warehouse-only commands (receive / warehouse waste / adjust) take only lock 2
and never wait on lock 1 while holding lock 2, so no reversed-order deadlock
exists. Balances are recomputed **after** the lock, never from a cache.

The `BEFORE INSERT` trigger re-takes the same locks in the same order, so even
a non-RPC write path cannot create negative stock, negative custody, or a
movement after final reconciliation.

Proven by the CI-gated two-session harness
(`scripts/native-db/consumable_concurrency.mjs`) with real interleavings:

1. two concurrent issues where stock satisfies only one;
2. issue racing a stock-decreasing adjustment on the same item;
3. two concurrent custody reductions (consume vs return) on one Event line;
4. Event movement racing final consumable reconciliation;
5. concurrent identical idempotent retry (one movement, one audit event, both
   callers replayed successfully).

## 5. Idempotency

Identical to the S4A contract: SHA-256 fingerprint of the canonical payload
stored under unique `(organization_id, idempotency_key)`.

- same key + same payload → original result;
- same key + different payload → `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`;
- concurrent identical retries re-check idempotency **after waiting on the
  shared lock**; the UNIQUE constraint is the final race guard.

## 6. Event consumable reconciliation

`event_consumable_reconciliations` holds at most one append-only row per
Event.

- rejected while any issued quantity is unexplained
  (`CONSUMABLE_OUTSTANDING_QUANTITY`);
- its CHECK constraint independently requires
  `issued = returned + consumed + event_waste`;
- shares the Event lock with every custody movement, so nothing can land
  immediately after closure;
- once reconciled, all further Event consumable movements are rejected;
  retries remain idempotent;
- correction of a final reconciliation is deliberately deferred to a future
  explicit audited mechanism — never mutation/deletion.

## 7. Cancellation

Cancellation never erases physical inventory obligations:

- issued consumables **remain Event custody**; nothing is auto-restocked;
- new issues to a cancelled Event are rejected (`EVENT_NOT_ISSUABLE`);
- returns, consumption and waste remain possible after cancellation until the
  custody is explicitly accounted for, then reconciliation closes the Event;
- an Event with no issued consumables needs no artificial movement.

## 8. Security

- RLS on all three business tables; SELECT restricted to active org members;
- **no client write path**: no INSERT/UPDATE/DELETE policies, Supabase default
  grants explicitly revoked, append-only/structural triggers as the third
  independent layer;
- SECURITY DEFINER commands pin `search_path = ''`; actor from `auth.uid()`;
- composite same-org FKs make cross-org references structurally impossible;
- **no cost anywhere in this slice**: the ledger, stock profile, read models
  and audit payloads contain zero cost/valuation columns (pgTAP asserts this),
  so WAREHOUSE performs all physical operations without commercial visibility;
- sensitive corrections (adjustment) and final closeout are OWNER/MANAGER.

## 9. Financial boundary

S4B records **physical quantity truth only**. No COGS, FIFO, weighted-average
costing or GL postings exist because the repository has no accounting posting
contract; "historical cost" computed from the mutable current catalog cost
would be false history. The ledger keys (org, item, kind, exact quantity,
actor, time, reference, idempotency identity) are exactly what a future
authoritative costing slice needs.

## 10. Lot / expiry boundary

Batch/expiry control is **explicitly deferred to S5+** (supplier receipts,
where lots physically originate). No decorative lot/expiry columns exist in
S4B: a stored-but-unenforced expiry would be a half-model that lies during
issue. When lots arrive, they will subdivide `RECEIVE` movements without
replacing this ledger as the balance source of truth.

## 11. Read models and low stock

- `consumable_stock_summary` — per tracked item: catalog identity, unit, exact
  on-hand, minimum threshold, `is_low_stock = on_hand <= minimum`, tracking
  state. S5 procurement will consume this signal; no purchasing automation
  exists in S4B.
- `event_consumable_lines` — per Event/item: issued / returned usable /
  consumed / wasted / outstanding + reconciliation status.
- `event_consumable_summary(org, event)` — Event rollup driving the
  "حالة التسوية" badge (`NO_CONSUMABLES` / `OUTSTANDING` /
  `READY_TO_RECONCILE` / `RECONCILED`).

The frontend never coerces missing critical quantities to zero: defective rows
are surfaced as explicit "بيانات غير مكتملة" states.

## 12. Operator UX

- **المواد الاستهلاكية** page (main navigation): per item الصنف / الوحدة /
  الرصيد الحالي / الحد الأدنى / منخفض المخزون, with استلام / إتلاف /
  تعديل الرصيد (manager-only) actions; destructive actions require reason +
  explicit confirmation.
- **المواد** tab in the Event workspace: per item تم صرفه / مرتجع صالح /
  تم استهلاكه / هالك / المتبقي مع المناسبة plus حالة التسوية and the final
  OWNER/MANAGER reconciliation confirmation.
- Arabic/RTL first, large touch targets, exact decimal entry, explicit blocked
  reasons, no UUID/SQL leakage, low-stock banner without dashboard clutter.

## 13. S5 integration point

Future supplier receipts must create/link authoritative `RECEIVE` movements in
`consumable_movements` (e.g. via `reference` or a future FK column added by
S5) rather than introducing any second stock balance. The S4B ledger remains
the single inventory quantity source of truth.

## Explicitly deferred

- suppliers, purchase orders, invoices, payables, procurement (S5);
- purchasing automation from the low-stock signal (S5);
- lot/batch/expiry control (S5+, named above);
- inventory valuation/COGS/GL postings (post-S5 accounting contract);
- audited correction/reversal of a final consumable reconciliation.
