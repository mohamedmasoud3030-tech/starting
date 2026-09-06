import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { callRpc } from "@/lib/rpc";

/**
 * Accounting read-model data layer (migrations 0094 + 0096).
 *
 * Every figure comes from the canonical SECURITY DEFINER SQL functions —
 * gated server-side by `cost.visibility` — and this file only binds them to
 * React Query. No aggregation, no money arithmetic, and no organization
 * scoping is done client-side; an empty result means "no rows", never a
 * fabricated zero.
 *
 * Row contracts are explicit (not derived from the generated function
 * returns) because the server genuinely returns NULL in several fields the
 * generator cannot see as nullable (e.g. a supplier statement row with no
 * event, or an aging row with no origin date). The surfaces must render those
 * nulls, never coerce them.
 */

export interface ArAgingRow {
  event_id: string;
  event_number: string;
  customer_id: string;
  customer_name: string;
  /** Gross accounts receivable incl. VAT (contract §5). */
  ar_gross: number;
  ar_origin_date: string | null;
  age_days: number | null;
  aging_bucket: string;
}

export interface ApAgingRow {
  supplier_id: string;
  supplier_name: string;
  ap_balance: number;
  ap_origin_date: string | null;
  age_days: number | null;
  aging_bucket: string;
}

export interface ContractAssetAgingRow {
  event_id: string;
  event_number: string;
  customer_id: string;
  customer_name: string;
  /** Gross contract asset incl. VAT (contract §4 Option B). */
  contract_asset_gross: number;
  recognition_date: string | null;
  age_days: number | null;
  aging_bucket: string;
}

/** Supplier position (0094) — used as the supplier picker + AP balance. */
export interface SupplierPositionRow {
  supplier_id: string;
  supplier_name: string;
  ap_balance: number;
  open_invoice_count: number;
  last_posting_date: string | null;
}

/** Supplier statement row (chronological AP activity + running balance). */
export interface SupplierStatementRow {
  entry_date: string;
  created_at: string;
  entry_number: string;
  source_type: string;
  is_reversal: boolean;
  event_id: string | null;
  event_number: string | null;
  document_number: string | null;
  document_date: string | null;
  ap_debit: number;
  ap_credit: number;
  running_balance: number;
  memo: string | null;
}

/**
 * One authoritative allocation record (§17) carried on a customer-statement
 * row when its source document participates in one (server `jsonb`).
 */
export interface StatementAllocation {
  payment_reference: string | null;
  invoice_number: string | null;
  gross_amount: number | null;
  net_amount: number | null;
  vat_amount: number | null;
}

/** Customer statement row (chronological outstanding activity + allocations). */
export interface CustomerStatementRow {
  entry_date: string;
  created_at: string;
  entry_number: string;
  source_type: string;
  is_reversal: boolean;
  event_id: string;
  event_number: string;
  customer_id: string;
  customer_name: string;
  document_number: string | null;
  impact_on_outstanding: number;
  running_outstanding: number;
  allocations: StatementAllocation[] | null;
  memo: string | null;
}

/** Page size for the paginated statement surfaces (server `p_limit`). */
export const STATEMENT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Aging (0096)
// ---------------------------------------------------------------------------

export function useArAging(orgId: string | null) {
  return useQuery({
    queryKey: ["accounting-ar-aging", orgId],
    enabled: !!orgId,
    queryFn: () =>
      callRpc<ArAgingRow[]>("accounting_ar_aging", { p_org_id: orgId! }),
  });
}

export function useApAging(orgId: string | null) {
  return useQuery({
    queryKey: ["accounting-ap-aging", orgId],
    enabled: !!orgId,
    queryFn: () =>
      callRpc<ApAgingRow[]>("accounting_ap_aging", { p_org_id: orgId! }),
  });
}

export function useContractAssetAging(orgId: string | null) {
  return useQuery({
    queryKey: ["accounting-contract-asset-aging", orgId],
    enabled: !!orgId,
    queryFn: () =>
      callRpc<ContractAssetAgingRow[]>("accounting_contract_asset_aging", {
        p_org_id: orgId!,
      }),
  });
}

// ---------------------------------------------------------------------------
// Supplier statement (0096) — supplier picker comes from 0094 positions
// ---------------------------------------------------------------------------

export function useSupplierPositions(orgId: string | null) {
  return useQuery({
    queryKey: ["accounting-supplier-positions", orgId],
    enabled: !!orgId,
    queryFn: () =>
      callRpc<SupplierPositionRow[]>("accounting_supplier_positions", {
        p_org_id: orgId!,
      }),
  });
}

export function useSupplierStatement(
  orgId: string | null,
  supplierId: string | null,
  limit: number,
) {
  return useQuery({
    queryKey: ["accounting-supplier-statement", orgId, supplierId, limit],
    enabled: !!orgId && !!supplierId,
    placeholderData: keepPreviousData,
    queryFn: () =>
      callRpc<SupplierStatementRow[]>("accounting_supplier_statement", {
        p_org_id: orgId!,
        p_supplier_id: supplierId!,
        p_limit: limit,
        p_offset: 0,
      }),
  });
}

// ---------------------------------------------------------------------------
// Customer statement (0096) with allocation detail
// ---------------------------------------------------------------------------

export function useAccountingCustomerStatement(
  orgId: string | null,
  customerId: string | null,
  limit: number,
) {
  return useQuery({
    queryKey: ["accounting-customer-statement", orgId, customerId, limit],
    enabled: !!orgId && !!customerId,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const rows = await callRpc<
        Array<
          Omit<CustomerStatementRow, "allocations"> & {
            allocations: unknown;
          }
        >
      >("accounting_customer_statement", {
        p_org_id: orgId!,
        p_customer_id: customerId!,
        p_limit: limit,
        p_offset: 0,
      });
      return rows.map((r) => ({
        ...r,
        allocations:
          r.allocations == null
            ? null
            : (r.allocations as StatementAllocation[]),
      })) satisfies CustomerStatementRow[];
    },
  });
}
