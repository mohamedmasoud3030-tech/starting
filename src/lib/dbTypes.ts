/**
 * Hand-written application/domain type layer over the GENERATED Supabase types.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `src/lib/database.types.ts` is generator-owned. It is produced verbatim by
 *
 *     supabase gen types typescript --local --schema public
 *
 * and CI fails the build if the committed file differs by even one byte from
 * that output (see the "Fail if committed types drift from generated schema"
 * step in .github/workflows/ci.yml). Therefore NOTHING may be hand-added to it
 * — not aliases, not convenience exports, not tweaked property types.
 *
 * Every application-facing alias is derived HERE, from the generated
 * `Database` type, so the aliases can never drift away from the real schema:
 * if a table, column, or enum value changes in a migration, the regenerated
 * `Database` changes and these aliases change with it (or fail to compile).
 *
 * Import application types from `@/lib/dbTypes`, never from
 * `@/lib/database.types` (the only legitimate consumer of the generated module
 * is `src/lib/supabase.ts`, which needs the raw `Database` generic).
 */

import type { Database } from "./database.types";

/** The `public` schema as generated. */
type Public = Database["public"];

// ---------------------------------------------------------------------------
// Generic helpers — derive rows/inserts/updates/args from the generated schema
// ---------------------------------------------------------------------------

/** Row type of a `public` table. */
export type TableRow<T extends keyof Public["Tables"]> =
  Public["Tables"][T]["Row"];

/** Insert type of a `public` table. */
export type TableInsert<T extends keyof Public["Tables"]> =
  Public["Tables"][T]["Insert"];

/** Update type of a `public` table. */
export type TableUpdate<T extends keyof Public["Tables"]> =
  Public["Tables"][T]["Update"];

/** Row type of a `public` view (all columns are nullable by construction). */
export type ViewRow<T extends keyof Public["Views"]> =
  Public["Views"][T]["Row"];

/** Argument object of a `public` function (RPC). */
export type FunctionArgs<T extends keyof Public["Functions"]> =
  Public["Functions"][T]["Args"];

/** Return type of a `public` function (RPC). */
export type FunctionReturns<T extends keyof Public["Functions"]> =
  Public["Functions"][T]["Returns"];

/** A `public` enum type. */
export type DbEnum<T extends keyof Public["Enums"]> = Public["Enums"][T];

// ---------------------------------------------------------------------------
// Enum aliases
// ---------------------------------------------------------------------------

export type AppRole = DbEnum<"app_role">;
export type AssignmentStatus = DbEnum<"assignment_status">;
export type CatalogItemStatus = DbEnum<"catalog_item_status">;
export type CatalogItemType = DbEnum<"catalog_item_type">;
export type CompensationMethod = DbEnum<"compensation_method">;
export type ConsumableMovementKind = DbEnum<"consumable_movement_kind">;
export type CustomerType = DbEnum<"customer_type">;
export type CustomerPaymentStatus = DbEnum<"customer_payment_status">;
export type EventStatus = DbEnum<"event_status">;
export type PaymentMethod = DbEnum<"payment_method">;
export type ProcurementLineKind = DbEnum<"procurement_line_kind">;
export type ProcurementOrderStatus = DbEnum<"procurement_order_status">;
export type SupplierCategory = DbEnum<"supplier_category">;
export type SupplierStatus = DbEnum<"supplier_status">;
export type MembershipStatus = DbEnum<"membership_status">;
export type PackageStatus = DbEnum<"package_status">;
export type PricingMethod = DbEnum<"pricing_method">;
export type QuotationStatus = DbEnum<"quotation_status">;
export type ReservationStatus = DbEnum<"reservation_status">;
export type StaffType = DbEnum<"staff_type">;

// ---------------------------------------------------------------------------
// Table row aliases
// ---------------------------------------------------------------------------

export type OrganizationRow = TableRow<"organizations">;
export type MembershipRow = TableRow<"organization_memberships">;
export type ProfileRow = TableRow<"profiles">;

export type CustomerRow = TableRow<"customers">;
export type CustomerInsert = TableInsert<"customers">;
export type CustomerUpdate = TableUpdate<"customers">;

export type CatalogCategoryRow = TableRow<"catalog_categories">;
export type CatalogItemRow = TableRow<"catalog_items">;
export type CatalogItemInsert = TableInsert<"catalog_items">;
export type CatalogItemUpdate = TableUpdate<"catalog_items">;

export type PackageRow = TableRow<"packages">;
export type PackageInsert = TableInsert<"packages">;
export type PackageItemRow = TableRow<"package_items">;

export type SupplierRow = TableRow<"suppliers">;
export type CustomerPaymentRow = TableRow<"customer_payments">;
export type ProcurementOrderRow = TableRow<"procurement_orders">;
export type ProcurementOrderLineRow = TableRow<"procurement_order_lines">;
export type ProcurementReceiptRow = TableRow<"procurement_receipts">;
export type ProcurementReceiptLineRow = TableRow<"procurement_receipt_lines">;

// ---------------------------------------------------------------------------
// View row aliases (operational / customer-facing projections)
// ---------------------------------------------------------------------------

/**
 * Non-sensitive catalog projection. It deliberately exposes no `cost_price`
 * and no `internal_notes`; every column is nullable because PostgreSQL cannot
 * prove view-column nullability.
 */
export type CatalogItemOperationalRow = ViewRow<"catalog_items_operational">;

export type SupplierSummaryRow = ViewRow<"supplier_summaries">;
export type SupplierDetailRow = ViewRow<"supplier_details">;
export type ProcurementOrderSummaryRow = ViewRow<"procurement_order_summaries">;
export type ProcurementOrderDetailRow = ViewRow<"procurement_order_details">;
export type ProcurementOrderLineSummaryRow =
  ViewRow<"procurement_order_line_summaries">;
export type ProcurementReceiptSummaryRow =
  ViewRow<"procurement_receipt_summaries">;
export type ProcurementReceiptLineSummaryRow =
  ViewRow<"procurement_receipt_line_summaries">;
export type ProcurementReceivingOrderSummaryRow =
  ViewRow<"procurement_receiving_order_summaries">;
export type ProcurementReceivingLineSummaryRow =
  ViewRow<"procurement_receiving_line_summaries">;
export type EventProcurementCostSummaryRow =
  ViewRow<"event_procurement_cost_summaries">;
export type CustomerPaymentSummaryRow = ViewRow<"customer_payment_summaries">;
export type EventFinanceSummaryRow = ViewRow<"event_finance_summaries">;
