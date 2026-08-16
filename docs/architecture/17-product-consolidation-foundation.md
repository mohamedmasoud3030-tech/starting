# R10 — Product Consolidation Foundation

Status: **implemented foundation**

This document is the anti-duplication and information-architecture contract for the Hospitality application. New features must extend these canonical flows instead of creating parallel tables, ledgers, draft systems, or top-level navigation areas by default.

## 1. Canonical business flow

The product is an operating system for a hospitality/event-service business. The main operational chain is:

```text
Prospect / Customer
  -> Quote
  -> Confirmed Event
  -> Staff + Equipment + Consumables
  -> Procurement / Receiving when needed
  -> Invoice
  -> Payment
  -> Event closeout
```

Each step may have supporting records and immutable history, but there must be one authoritative aggregate or ledger for each business fact.

## 2. Schema consolidation rule

### Command replay / idempotency

Canonical physical storage is now:

- `command_idempotency`

It is namespaced by:

- `organization_id`
- `command_scope`
- `idempotency_key`

The former domain tables are no longer physical storage:

- `procurement_command_idempotency`
- `payments_command_idempotency`
- `staff_payroll_command_idempotency`

They exist only as deprecated compatibility views while older diagnostics/tests transition. Existing domain RPCs keep their established replay behaviour through internal wrappers backed by the canonical register.

The canonical register and replay helpers are internal machinery, not frontend contracts. They remain inaccessible to authenticated clients.

### Catalog versus operational state

The following are deliberately separate and must not be collapsed merely because they refer to the same sellable/resource item:

- `catalog_items` — master commercial definition and default pricing
- `equipment_capacity` — reusable-equipment operational capacity
- `consumable_stock_items` — consumable inventory tracking profile

This separation is canonical: master identity/pricing is not the same fact as stock or reusable capacity.

### Canonical quotation lifecycle (R11)

R11 completed the deferred consolidation. `quotations` / `quotation_lines` are the only physical quotation aggregate and line storage for both editable drafts and issued snapshots. The lifecycle is `DRAFT -> ISSUED -> ACCEPTED -> CONVERTED`, with `CANCELLED` and the established event-revision `SUPERSEDED` terminal paths.

The former `quick_quotes`, `quick_quote_lines`, and `quick_quote_applied_packages` relations and RPCs are retired after transactional row migration and count assertions. Package provenance is represented on quote-owned snapshot lines rather than a second workspace marker. See `09-quick-quote.md` and `19-r11-domain-audit.md`.

## 3. Information architecture

The UI is organized by work, not by database module names.

Current navigation groups are:

1. **الرئيسية** — operational overview and actions requiring attention.
2. **المناسبات** — event list and event workspace.
3. **المبيعات والعملاء** — quotes, customers, packages.
4. **التشغيل والمخزن** — service/material catalog and consumable stock.
5. **المشتريات** — suppliers, purchase orders, receiving.
6. **الفريق** — hosts, attendance and payroll-capable workflows according to role.

Finance/admin should become a dedicated group only when real top-level routes exist. Do not create placeholder navigation or dead routes simply to complete a menu.

Desktop uses persistent grouped navigation. Mobile keeps the highest-frequency actions in bottom navigation and exposes the same grouped hierarchy in the overflow menu.

## 4. Non-negotiable implementation rules

- One modular application and one Supabase/Postgres database.
- Append-only forward migrations; never silently rewrite an applied migration.
- Default-deny RLS for internal/raw data and explicit stable client contracts.
- `SECURITY DEFINER` functions use pinned `search_path` and explicit authorization.
- OMR monetary facts remain exact decimal values at three decimal places; never use binary floating point for stored financial truth.
- Transactional commands retain idempotency and concurrency guarantees.
- Do not add a new table because a screen needs local state. First identify the authoritative business fact and existing aggregate.
- Do not delete or merge tables based on similar names. Build a dependency map of foreign keys, RPCs, frontend readers/writers, tests, and documents first.
- Generated database types must match a clean migration replay in CI.

## 5. Next consolidation boundary

After this foundation is green, the next schema simplification candidate is the Quick Quote / issued quotation lifecycle. That change must be treated as a separate migration and product-flow refactor, because it affects commercial issuance, acceptance, Customer/Event conversion, frontend editing state, idempotency, and immutable snapshots together.

The visual redesign should follow the canonical domain and IA rather than masking duplicated concepts with new styling.
