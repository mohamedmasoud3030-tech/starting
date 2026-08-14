# 12 — S5A Suppliers, Catering Orders & Procurement Core

> Server-authoritative supplier/procurement domain for the Oman hospitality
> office. This is the backend contract consumed by the parallel S5 operator UX.
> It records negotiated cost and delivery truth; S6 accounting/profitability is
> deliberately not implemented here.

## 1. Aggregate and lifecycle

`procurement_orders` is the aggregate serialization row. The exact lifecycle is:

```text
DRAFT → APPROVED → SENT → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED
   └──────────────── cancellation from every state except RECEIVED ─→ CANCELLED
```

Rules:

- only `DRAFT` headers and lines are editable;
- approval requires an active supplier and at least one valid line;
- `APPROVED` cannot skip `SENT`, and `SENT` cannot skip `CONFIRMED`;
- only `CONFIRMED` / `PARTIALLY_RECEIVED` orders accept a receipt;
- receiving derives `PARTIALLY_RECEIVED` versus `RECEIVED` from exact cumulative
  line quantities, never from a client-provided target status;
- `RECEIVED` and `CANCELLED` are terminal;
- cancellation after a partial receipt preserves all receipt and S4B movement
  facts. Cancellation never removes physical stock.

The supplier lifecycle is `ACTIVE | INACTIVE`. Inactive suppliers remain
historical references but cannot be selected for a new or newly-approved order.

## 2. Data model

| Object | Purpose |
| --- | --- |
| `suppliers` | org-scoped supplier identity/contact master with soft lifecycle |
| `procurement_orders` | aggregate header, human `PO-YYYY-NNNNN`, supplier/Event and approval snapshots |
| `procurement_order_lines` | negotiated immutable quantity/unit/cost snapshots |
| `procurement_receipts` | append-only delivery/performance command fact |
| `procurement_receipt_lines` | exact received quantity and optional S4B movement link |
| `procurement_command_idempotency` | internal `(organization,key)` fingerprint + exact original response snapshot |

Line kinds are:

- `CONSUMABLE` — requires an active `CONSUMABLE` catalog item and its existing
  tracked `consumable_stock_items` row;
- `CATERING_SERVICE` — may be non-catalog and never receives fake stock identity;
- `OTHER` — another justified procured item/service, optionally catalog-linked.

A linked catalog is a source identity only. `description`, `unit`, `quantity`,
`agreed_unit_cost` and `agreed_total_cost` are persisted snapshots. Supplier
name/contact/phone are additionally frozen at approval. Later supplier or
catalog edits cannot restate approved history.

No tax columns exist because the repository has no existing tax contract.

## 3. Exact OMR and quantity

Both quantity and stored OMR use `numeric(12,3)`. Commands reject rather than
round input with more than three decimal places. Extended line cost is computed
in PostgreSQL as:

```sql
round(quantity * agreed_unit_cost, 3)
```

PostgreSQL `round(numeric, 3)` is half away from zero. The result and aggregate
order total are range-checked against `999,999,999.999`. The frontend adapter
sends line quantity/money as exact decimal strings inside JSON; no binary-float
arithmetic is a cost source of truth.

## 4. S4B receiving integration

`receive_procurement_order` executes one transaction:

1. validate auth/role and idempotency fingerprint;
2. lock the order aggregate;
3. validate every requested line and exact remaining quantity;
4. for each `CONSUMABLE` line, call the existing internal S4B movement writer
   to create one authoritative `consumable_movements(kind = RECEIVE)` row;
5. insert `procurement_receipt_lines.consumable_movement_id`, a composite
   same-organization FK to that movement;
6. derive and update the order receipt status;
7. append audit and idempotency response facts.

There is no procurement stock counter. Warehouse on-hand remains exactly
`sum(consumable_movements.warehouse_delta)`.

A service/catering line has no stock movement: receipt means confirmed delivery
or performance. `WAREHOUSE` may receive only `CONSUMABLE` lines;
`OWNER`/`MANAGER`/`SUPERVISOR` may confirm both physical and service lines.

Over-receipt is not supported in S5A. Cumulative quantity greater than ordered
raises `PROCUREMENT_OVER_RECEIPT`; there is no implicit tolerance.

## 5. Idempotency and concurrency

Every public mutation requires a UUID idempotency key. Canonical JSON payloads
are SHA-256 fingerprinted.

- same org + key + payload → exact original response snapshot;
- same org + key + different payload →
  `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`;
- one command key produces at most one business result and parent audit row.

The exact response is stored because orders/suppliers are mutable aggregates: a
late retry of approval must return the original `APPROVED` result even if the
order is now `RECEIVED`.

Stable lock order:

1. advisory transaction lock for `(organization_id, idempotency_key)`;
2. procurement order row;
3. supplier row for approval (shared with supplier lifecycle commands);
4. S4B stock-item rows, ordered by UUID for a multi-line receipt.

Supplier-only commands take the idempotency lock then supplier row. No path
holds a stock row while waiting for an order row. The native two-session harness
proves:

- two receipts against one remaining quantity;
- receipt versus cancellation;
- concurrent identical receipt retry;
- two stale lifecycle transitions;
- supplier deactivation versus order approval.

## 6. Authorization and confidentiality

| Operation/data | OWNER | MANAGER | SUPERVISOR | WAREHOUSE | ACCOUNTANT |
| --- | ---: | ---: | ---: | ---: | ---: |
| supplier/order create/edit/lifecycle | ✅ | ✅ | ❌ | ❌ | ❌ |
| approve/send/confirm/cancel | ✅ | ✅ | ❌ | ❌ | ❌ |
| receive consumable | ✅ | ✅ | ✅ | ✅ | ❌ |
| confirm service delivery | ✅ | ✅ | ✅ | ❌ | ❌ |
| read negotiated costs/internal notes | ✅ | ✅ | ❌ | ❌ | ✅ |
| read cost-free receiving/contact projections | ✅ | ✅ | ✅ | ✅ | ✅ |

All tables have RLS enabled and composite tenant-safe foreign keys. There are no
client write policies and all Supabase default table grants are explicitly
revoked. Raw S5A tables have no authenticated grant; the frontend reads only the
views below. SECURITY DEFINER functions have `search_path = ''` and derive the
actor from `auth.uid()`.

## 7. Frontend integration contract

### Read models

All are `SELECT` views. Filter with `.eq("organization_id", orgId)` and, where
relevant, `.eq("order_id", orderId)` / `.eq("event_id", eventId)`.

#### `supplier_summaries` — every active org member

```text
supplier_id, organization_id, name, category,
contact_name, phone, whatsapp, status, created_at, updated_at
```

No commercial registration, email, notes or costs.

#### `supplier_details` — OWNER/MANAGER/ACCOUNTANT

```text
supplier_id, organization_id, name, category,
commercial_registration_number, contact_name, phone,
whatsapp, email, notes, status, created_at, updated_at
```

#### `procurement_order_summaries` — OWNER/MANAGER/ACCOUNTANT

```text
order_id, organization_id, order_number, supplier_id, supplier_name,
event_id, event_number, event_title, order_date, expected_delivery_at,
status, agreed_total_cost, line_count,
approved_at, sent_at, confirmed_at, cancelled_at, created_at, updated_at
```

#### `procurement_order_details` — OWNER/MANAGER/ACCOUNTANT

```text
order_id, organization_id, order_number, supplier_id, supplier_name,
supplier_name_snapshot, supplier_contact_name_snapshot,
supplier_phone_snapshot, event_id, event_number, event_title,
order_date, expected_delivery_at, notes, status, agreed_total_cost,
approved_by, approved_at, sent_by, sent_at, confirmed_by, confirmed_at,
cancelled_by, cancelled_at, cancellation_reason,
created_by, created_at, updated_at
```

#### `procurement_order_line_summaries` — OWNER/MANAGER/ACCOUNTANT

```text
order_line_id, organization_id, order_id, line_kind,
catalog_item_id, stock_item_id, description, unit,
ordered_quantity, received_quantity, remaining_quantity,
agreed_unit_cost, agreed_total_cost, sort_order, created_at
```

#### `procurement_receipt_summaries` — every active org member

```text
receipt_id, organization_id, order_id, order_number, order_status,
event_id, supplier_name, received_at, reference, notes, received_by,
line_count, has_stock_movements, created_at
```

#### `procurement_receipt_line_summaries` — every active org member

```text
receipt_line_id, organization_id, order_id, receipt_id,
order_line_id, quantity, consumable_movement_id, created_at
```

#### `procurement_receiving_order_summaries` — every active org member

Cost-free operational header:

```text
order_id, organization_id, order_number, supplier_id, supplier_name,
supplier_contact_name, supplier_phone, event_id, event_number, event_title,
order_date, expected_delivery_at, status, confirmed_at, updated_at
```

#### `procurement_receiving_line_summaries` — every active org member

Cost-free line state:

```text
order_line_id, organization_id, order_id, line_kind,
catalog_item_id, stock_item_id, description, unit,
ordered_quantity, received_quantity, remaining_quantity, sort_order
```

#### `event_procurement_cost_summaries` — OWNER/MANAGER/ACCOUNTANT

```text
organization_id, event_id, event_number,
active_order_count, cancelled_order_count,
all_approved_order_cost, active_committed_cost, delivered_cost
```

`delivered_cost` is based on receipt quantities × immutable negotiated unit cost
and includes receipt facts preserved by later cancellation.

### Command RPCs

All return one generated table row. Optional text may be sent as `""` (server
normalizes to NULL). `p_lines` is JSONB.

```text
create_supplier(
  p_org_id, p_name, p_category,
  p_commercial_registration_number, p_contact_name, p_phone,
  p_whatsapp, p_email, p_notes, p_idempotency_key
) -> suppliers row

update_supplier(
  p_org_id, p_supplier_id, p_name, p_category,
  p_commercial_registration_number, p_contact_name, p_phone,
  p_whatsapp, p_email, p_notes, p_idempotency_key
) -> suppliers row

set_supplier_status(
  p_org_id, p_supplier_id, p_status, p_idempotency_key
) -> suppliers row

create_procurement_order(
  p_org_id, p_supplier_id, p_event_id, p_order_date,
  p_expected_delivery_at, p_notes, p_lines, p_idempotency_key
) -> procurement_orders row

update_procurement_order(
  p_org_id, p_order_id, p_supplier_id, p_event_id, p_order_date,
  p_expected_delivery_at, p_notes, p_lines, p_idempotency_key
) -> procurement_orders row

approve_procurement_order(p_org_id, p_order_id, p_idempotency_key)
send_procurement_order(p_org_id, p_order_id, p_idempotency_key)
confirm_procurement_order(p_org_id, p_order_id, p_idempotency_key)
  -> procurement_orders row

cancel_procurement_order(
  p_org_id, p_order_id, p_reason, p_idempotency_key
) -> procurement_orders row

receive_procurement_order(
  p_org_id, p_order_id, p_received_at,
  p_reference, p_notes, p_lines, p_idempotency_key
) -> procurement_receipts row
```

Order draft line JSON:

```json
{
  "line_kind": "CONSUMABLE | CATERING_SERVICE | OTHER",
  "catalog_item_id": "uuid or null",
  "description": "required for a non-catalog line",
  "unit": "required for a non-catalog line",
  "quantity": "10.000",
  "agreed_unit_cost": "1.250"
}
```

Receipt line JSON:

```json
{ "order_line_id": "uuid", "quantity": "4.125" }
```

`src/lib/procurement.api.ts` is the generated-type-backed adapter implementing
these calls without raw table queries.

### Domain error codes

| Code | Meaning |
| --- | --- |
| `NOT_AUTHENTICATED`, `NOT_AUTHORIZED` | auth/role failure |
| `IDEMPOTENCY_KEY_REQUIRED` | command key omitted |
| `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` | key reused for another canonical intent |
| `SUPPLIER_NAME_REQUIRED`, `SUPPLIER_NOT_FOUND`, `SUPPLIER_NOT_ACTIVE`, `SUPPLIER_ALREADY_IN_STATUS` | supplier validation/lifecycle |
| `PROCUREMENT_ORDER_NOT_FOUND` | order absent in caller organization |
| `PROCUREMENT_ORDER_DATE_REQUIRED` | draft date absent |
| `EVENT_NOT_PROCUREABLE` | Event absent/cross-org/closed/cancelled |
| `PROCUREMENT_LINES_MUST_BE_ARRAY`, `INVALID_PROCUREMENT_LINE`, `INVALID_PROCUREMENT_LINE_KIND` | malformed draft payload |
| `PROCUREMENT_CONSUMABLE_CATALOG_REQUIRED`, `CONSUMABLE_STOCK_ITEM_NOT_TRACKED`, `PROCUREMENT_LINE_KIND_MISMATCH` | catalog/S4B linkage invalid |
| `PROCUREMENT_LINE_DESCRIPTION_REQUIRED`, `PROCUREMENT_LINE_UNIT_REQUIRED` | non-catalog snapshot incomplete |
| `INVALID_QUANTITY`, `QUANTITY_PRECISION_EXCEEDED`, `QUANTITY_OUT_OF_RANGE` | exact quantity invalid |
| `INVALID_OMR_AMOUNT`, `OMR_PRECISION_EXCEEDED`, `OMR_AMOUNT_OUT_OF_RANGE` | exact cost invalid |
| `PROCUREMENT_ORDER_LINES_REQUIRED` | empty draft cannot approve |
| `PROCUREMENT_ORDER_NOT_EDITABLE`, `PROCUREMENT_COMMERCIAL_SNAPSHOT_IMMUTABLE` | approved history cannot change |
| `INVALID_PROCUREMENT_ORDER_TRANSITION` | lifecycle edge invalid/stale |
| `PROCUREMENT_CANCELLATION_REASON_REQUIRED`, `PROCUREMENT_ORDER_NOT_CANCELLABLE` | cancellation invalid |
| `PROCUREMENT_ORDER_NOT_RECEIVABLE` | order is not confirmed/partial |
| `PROCUREMENT_RECEIPT_LINES_REQUIRED`, `INVALID_PROCUREMENT_RECEIPT_LINE`, `DUPLICATE_PROCUREMENT_RECEIPT_LINE` | malformed receipt payload |
| `PROCUREMENT_ORDER_LINE_NOT_FOUND` | line absent/cross-order/cross-org |
| `PROCUREMENT_OVER_RECEIPT` | cumulative exact quantity exceeds ordered |
| `WAREHOUSE_PHYSICAL_RECEIPT_ONLY` | WAREHOUSE attempted service confirmation |
| `CONSUMABLE_TRACKING_INACTIVE` | linked S4B stock tracking is no longer active |

## 8. Audit

The existing `audit_events` framework records supplier create/update/status,
order create/update/approval/send/confirmation/cancellation, and partial/final
receipt. Procurement audit metadata contains bounded identifiers/status/amount
facts and the parent idempotency key. An expression unique index prevents a
second procurement-domain audit row for the same parent command key. S4B
`CONSUMABLE_RECEIVED` remains a separate physical-ledger audit fact with a
deterministic child key.

## 9. Explicitly deferred to S6+

- supplier invoices and invoice matching;
- accounts payable and payment settlement;
- customer payments;
- GL/journal postings and tax accounting;
- inventory valuation/COGS policy;
- Event profitability/dashboard calculations;
- over-receipt tolerance/approval policy;
- receipt reversal/return-to-supplier workflow;
- lots/expiry enforcement (requires a complete issue-allocation policy, not
  decorative receipt fields).
