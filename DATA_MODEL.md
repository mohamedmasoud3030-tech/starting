# DATA_MODEL.md — Database Schema, Ownership and Lifecycles

> Reconstructed 2026-08-17 by replaying all 56 migrations against a clean
> PostgreSQL instance and querying the live catalog. Counts below are from that
> replayed schema: **36 business tables · 31 views · 143 business functions
> (excluding 11 pgTAP shims) · 50 RLS policies · 40 triggers · 132 indexes ·
> RLS enabled on 36/36 business tables · 27 enums**.

---

## 1. Global conventions

- **Tenancy:** every business table carries `organization_id`; the only table
  without it is `organizations` itself (the tenant root). Composite foreign
  keys `(organization_id, id)` make cross-organization references impossible at
  the constraint level.
- **Money:** `numeric(12,3)` (OMR, 3 decimals) for all persisted amounts;
  quantities also `numeric(12,3)` in stock/procurement domains.
- **No destructive deletes:** master data uses ACTIVE/INACTIVE (`catalog_*`,
  `packages`, `suppliers`, `staff_members`, `customers.is_active`); ledgers are
  append-only with structural triggers; no client DELETE policies on business
  tables.
- **Audit:** `record_audit()` is internal-only (not callable by clients);
  authorized commands append to `audit_events`.
- **Idempotency:** canonical register `command_idempotency
  (organization_id, command_scope, idempotency_key)` + SHA-256 payload
  fingerprint; three legacy register names survive as read-only compatibility
  views (`procurement_command_idempotency`, `payments_command_idempotency`,
  `staff_payroll_command_idempotency`).
- **Timestamps:** `updated_at` maintained by `set_updated_at` triggers.
- **Read models:** client reads go through views; cost-bearing models filter
  with `can_read_cost(organization_id)`; operational projections
  (`catalog_items_operational`, `event_commercial_lines_operational`,
  `event_staff_assignments_operational`, `staff_members_operational`,
  `event_warehouse_lines`, …) strip cost/valuation columns.

## 2. Enums (27, verified)

`app_role` OWNER|MANAGER|SUPERVISOR|WAREHOUSE|ACCOUNTANT ·
`membership_status` ACTIVE|INACTIVE|INVITED ·
`customer_type` INDIVIDUAL|COMPANY|GOVERNMENT ·
`event_status` DRAFT|QUOTED|CONFIRMED|PREPARING|DISPATCHED|IN_PROGRESS|RETURNING|CLOSED|CANCELLED ·
`quotation_status` DRAFT|ISSUED|ACCEPTED|CONVERTED|CANCELLED|SUPERSEDED ·
`catalog_item_type` SERVICE|REUSABLE_EQUIPMENT|CONSUMABLE|STAFF|CATERING|TRANSPORT|ADDON|OTHER ·
`catalog_item_status` ACTIVE|INACTIVE · `package_status` ACTIVE|INACTIVE ·
`pricing_method` FIXED|PER_EVENT|PER_GUEST|PER_UNIT|PER_HOUR|PER_DAY|MANUAL ·
`warehouse_movement_kind` DISPATCH|RETURN · `warehouse_valuation_basis` CATALOG_COST_SNAPSHOT ·
`reservation_status`/`assignment_status` ACTIVE|RELEASED|CANCELLED ·
`consumable_movement_kind` RECEIVE|ISSUE_TO_EVENT|RETURN_FROM_EVENT|CONSUME_AT_EVENT|WASTE_AT_EVENT|WAREHOUSE_WASTE|ADJUSTMENT ·
`procurement_order_status` DRAFT|APPROVED|SENT|CONFIRMED|PARTIALLY_RECEIVED|RECEIVED|CANCELLED ·
`procurement_line_kind` CONSUMABLE|CATERING_SERVICE|OTHER ·
`supplier_status` ACTIVE|INACTIVE · `supplier_category` CATERING_RESTAURANT|CONSUMABLES|EQUIPMENT_RENTAL|GENERAL ·
`payment_method` CASH|BANK_TRANSFER|CARD|CHEQUE|MOBILE_WALLET|OTHER ·
`customer_payment_status` RECORDED|VOIDED · `invoice_status` ISSUED|CANCELLED ·
`invoice_installment_kind` DEPOSIT|INSTALLMENT|FINAL · `installment_status` PENDING|PAID|CANCELLED ·
`staff_type` HOST|HOSTESS|SUPERVISOR|DRIVER|WAREHOUSE|OTHER · `staff_shift` MORNING|EVENING ·
`attendance_status` PRESENT|LATE|PARTIAL|ABSENT|VOIDED ·
`compensation_method` PER_EVENT|PER_HOUR|PER_DAY|MANUAL ·
`host_payment_status` RECORDED|VOIDED

## 3. Domains, tables, ownership and lifecycle

### 3.1 Identity & tenancy
| Table | Purpose / lifecycle |
| --- | --- |
| `organizations` | Tenant root. `name`, `display_name`, `default_currency`, `timezone`, `is_active`. Inactive org blocks all member RLS access. UPDATE policy = OWNER. No name-uniqueness constraint (relevant to demo-mode scoping, see defect D2). |
| `profiles` | One row per `auth.users` id; auto-created by `on_auth_user_created` trigger; user reads/updates own row only. |
| `organization_memberships` | `(organization_id, user_id, role, status)`. ACTIVE/INACTIVE/INVITED. Only ACTIVE membership in ACTIVE org grants access. Write policy = OWNER. |

Commands: `create_organization` (browser roles revoked — migration 0056),
`is_org_member`, `has_org_role`, `can_manage_commercial`, `can_read_cost`.

### 3.2 Customers
`customers` — `organization_id`, name, phone, whatsapp, `customer_type`, notes,
`is_active`. Insert/update by OWNER/MANAGER/SUPERVISOR (policy-checked direct
writes). No hard delete; inactive customers are not selectable for new events.

### 3.3 Catalog & packages
- `catalog_categories` — optional grouping; ACTIVE/INACTIVE.
- `catalog_items` — the commercial master: `item_type`, `pricing_method`,
  `cost_price` (numeric 12,3), `selling_price`, `internal_notes`, `status`.
  Writes OWNER/MANAGER; base-table reads restricted to cost roles; operational
  projection for everyone else. Type-change/consumable-tracking guards
  (triggers).
- `packages` + `package_items` — templates with default quantities; replaced
  transactionally via `save_package()`; applying to a quotation/event expands
  to owned snapshot lines (`source_package_id`, `source_catalog_item_id`).

### 3.4 Events
- `events` — header + `event_number` (document sequence), customer link,
  `status`, `accepted_quotation_id`, venue/contact fields, `guest_count`.
  Lifecycle transitions are commands (`transition_event_status`,
  `cancel_event`, `accept_event_quotation`); no client DELETE.
- `event_status_history` — append-only transition log.
- `event_commercial_lines` — per-event snapshot lines (editable until pricing
  locked by acceptance; `EVENT_PRICING_LOCKED` otherwise).

### 3.5 Quotations
- `quotations` — draft and issued commercial document: `quotation_number`
  (`QT-…`, allocated at issue), `revision`, `status`, customer/event snapshot
  fields, totals (numeric 12,3). Issued rows immutable (trigger).
- `quotation_lines` — snapshot lines; editable only while parent is DRAFT
  (trigger); source catalog/package provenance stored.
- Commands: `persist_quotation_draft` (atomic head+lines, idempotent),
  `issue_quotation`, `accept_quotation`, `convert_quotation_to_event`
  (one transaction: create CONFIRMED event, copy snapshot lines, mark
  CONVERTED — unique `converted_event_id` + row lock prevent double events),
  `cancel_quotation_draft`, `apply_package_to_quotation`.
- Reads: `quotations_customer`, `quotation_lines_customer` (security_invoker).

### 3.6 Reusable equipment (S4A)
- `equipment_capacity` — per-org reusable-capacity pool linked to a catalog
  item; managed by OWNER/MANAGER/WAREHOUSE.
- `event_equipment_reservations` — time-window reservations per event.
- `event_equipment_movements` — append-only ledger: DISPATCH / RETURN with
  good/damaged/lost quantities and catalog-cost valuation snapshot.
- `event_warehouse_reconciliations` — at most one per event;
  `dispatched = returned + damaged + lost` CHECK; reconciliation blocked while
  outstanding > 0; OWNER/MANAGER.
- Commands: `reserve_event_equipment`, `dispatch_event_equipment`,
  `return_event_equipment`, `release_equipment_reservation`,
  `reconcile_event_warehouse`, `event_warehouse_summary`,
  `warehouse_reservation_state`, `equipment_availability`.
- Lock order Event → Reservation → Capacity; BEFORE-INSERT structural guards
  re-check boundaries (defense in depth).

### 3.7 Consumable stock (S4B)
- `consumable_stock_items` — tracking profile per org+catalog item.
- `consumable_movements` — append-only quantity ledger; GENERATED
  `warehouse_delta` / `event_delta` columns; balances always derived; both
  balances structurally prevented from going negative.
- `event_consumable_reconciliations` — final per-event reconciliation.
- Commands: `save_consumable_stock_item`, `receive_consumable_stock`,
  `issue_consumable_to_event`, `return_consumable_from_event`,
  `consume_consumable_at_event`, `waste_consumable_at_event`,
  `waste_consumable_stock` (reason required), `adjust_consumable_stock`
  (OWNER/MANAGER, audited), `reconcile_event_consumables`,
  `event_consumable_summary`, `consumable_stock_on_hand`.

### 3.8 Procurement (S5)
- `suppliers` — contact master, ACTIVE/INACTIVE, no-delete trigger.
- `procurement_orders` — `PO-YYYY-NNNNN`; strict lifecycle; supplier/event
  snapshots frozen at approval; `procurement_order_history_guard` +
  `event_lifecycle_guard` triggers.
- `procurement_order_lines` — immutable negotiated snapshots (kind
  CONSUMABLE/CATERING_SERVICE/OTHER).
- `procurement_receipts` / `procurement_receipt_lines` — append-only receiving
  facts; receipts link to S4B consumable movements; partial vs full received
  derived from cumulative quantities.
- Commands (OWNER/MANAGER): `create/update/approve/send/confirm/receive/cancel
  _procurement_order`, `create/update_supplier`, `set_supplier_status`.

### 3.9 Payments & invoices
- `customer_payments` — append-only financial ledger: `amount numeric(12,3) >
  0`, `payment_method`, `reference`, `paid_at`, `recorded_by`, idempotency +
  fingerprint, `RECORDED → VOIDED` (reason required, non-destructive).
- `invoices` + `invoice_installments` — issued from accepted quotation/event;
  installment kinds DEPOSIT/INSTALLMENT/FINAL; `paid_total`/`remaining_balance`
  and installment `effective_status` derived from the payments ledger.
- Commands: `record_customer_payment`, `void_customer_payment`,
  `create_event_invoice`, `void_invoice` (OWNER/MANAGER/ACCOUNTANT).

### 3.10 Staff, attendance & payroll
- `staff_members` — roster with default compensation; manage OWNER/MANAGER.
- `event_staff_assignments` — per-event assignments with time-overlap
  rejection; ACTIVE/RELEASED/CANCELLED.
- `staff_attendance` — one live record per (org, event, staff, date, shift);
  statuses PRESENT/LATE/PARTIAL/ABSENT + VOIDED corrections; `check_in`,
  `check_out`, break; earned = hours × rate (PER_HOUR) else fixed rate; ABSENT
  → 0; guards for missing times/checkout-before-checkin.
- `staff_advances` (host-level, event-independent) and `host_payouts`
  (optionally event-linked) — append-only ledgers with VOID; payroll summaries
  per event and global (`get_host_payroll_summary`).

### 3.11 Audit & infrastructure
- `audit_events` — organization, actor, action, entity, entity_id, timestamp,
  constrained metadata; SELECT policy OWNER/MANAGER; writes internal-only.
- `command_idempotency` — see §1; internal-only (authenticated clients cannot
  read it).
- `document_sequences` — number allocation for `EV-…`/`QT-…`/`PO-…`
  (`next_document_number`); internal.

## 4. Read models (31 views)

Cost-gated family (rows/cost filtered by `can_read_cost`): `supplier_details`,
`supplier_summaries`, `procurement_order_summaries`, `procurement_order_line_summaries`,
`procurement_order_details`, `procurement_receipt_summaries`,
`procurement_receipt_line_summaries`, `procurement_receiving_order_summaries`,
`procurement_receiving_line_summaries`, `event_procurement_cost_summaries`,
`event_finance_summaries`, `event_warehouse_lines_valued`,
`customer_payment_summaries`, `invoice_summaries`,
`invoice_installment_summaries`, `host_event_payroll_summaries`,
`host_payout_summaries`, `staff_advances_summaries`.
Operational projections: `catalog_items_operational`,
`event_commercial_lines_operational`, `event_staff_assignments_operational`,
`staff_members_operational`, `event_warehouse_lines`, `event_consumable_lines`,
`consumable_stock_summary`, `staff_attendance_summaries`,
`quotations_customer`, `quotation_lines_customer`. Compatibility:
`procurement_command_idempotency`, `payments_command_idempotency`,
`staff_payroll_command_idempotency`.

## 5. RLS and grants (verified on the replayed schema)

- RLS enabled and forced-by-policy-design on all 36 business tables.
- `anon`: no direct table grants; receives capabilities only through the
  inherited `public_demo_admin` role (demo mode) or via auth JWT as
  `authenticated`.
- `authenticated`: SELECT through row-scoped policies; direct write grants
  exist only on `customers`, `catalog_*`, `packages`, `package_items`,
  `staff_members`, `equipment_capacity`, `organizations` (UPDATE owner),
  `organization_memberships` (owner policy) — each guarded by role checks on
  the target row's `organization_id`.
- Sensitive functions not executable by clients: `record_audit`,
  `begin/finish_command`, `record_consumable_movement`, `create_organization`
  (post-migration 0056), `handle_new_user`.

## 6. Migrations & seed

- `supabase/migrations/` — 56 immutable, ordered files (0001–0048, timestamped
  0049–0055, 0056 security hardening). Replay from empty is CI-gated and was
  re-verified here on a clean PostgreSQL instance.
- `supabase/seed.sql` — intentionally empty: data is created by the
  application after an OWNER signs up (AGENTS.md policy).
- `src/lib/database.types.ts` is generator-owned (6038 lines); CI fails on any
  drift. Hand-written app types live in `src/lib/dbTypes.ts`.
