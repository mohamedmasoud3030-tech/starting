import { supabase } from "@/lib/supabase";
import { parseOMR, toDbAmount } from "@/lib/money";
import type {
  ContractSummary,
  MealBookingSummary,
  MealType,
  RestaurantSupplier,
} from "./types";

/**
 * Data access for «المطاعم المتعاقدة».
 *
 * The generated database.types.ts predates migration 0099, so this module
 * reaches the new cost-gated read models and command RPCs through a small
 * structural client. Authorization stays server-side: the views already gate
 * by can_read_cost and every write RPC re-checks the caller's role and runs
 * on the idempotency register. Columns are validated against the explicit
 * row types in ./types.ts.
 */

type DbResult<T> = { data: T; error: { message: string } | null };

interface ThenExec<T> {
  then: (
    resolve: (value: DbResult<T>) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => unknown;
}

type Builder<T> = ThenExec<T> & {
  eq: (column: string, value: unknown) => Builder<T>;
  order: (column: string, options?: { ascending?: boolean }) => Builder<T>;
};

interface DynamicClient {
  from: (table: string) => {
    select: (columns: string) => Builder<unknown[] | null>;
  };
  rpc: (fn: string, params: Record<string, unknown>) => ThenExec<unknown>;
}

const client = supabase as unknown as DynamicClient;

function query(table: string) {
  return client.from(table).select("*") as unknown as Builder<unknown[] | null>;
}

async function selectRows<T>(table: string, build: (q: Builder<unknown[] | null>) => Builder<unknown[] | null>): Promise<T[]> {
  const { data } = await build(query(table));
  return (data ?? []) as T[];
}

async function runRpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const { data } = await client.rpc(fn, params);
  return data as T;
}

/* ------------------------- reads ------------------------- */

export async function listCateringRestaurants(
  orgId: string,
): Promise<RestaurantSupplier[]> {
  const rows = await selectRows<RestaurantSupplier>(
    "supplier_summaries",
    (q) => q.eq("organization_id", orgId).eq("category", "CATERING_RESTAURANT").eq("status", "ACTIVE"),
  );
  return rows.filter((row) => row.supplier_id);
}

export async function listContracts(orgId: string): Promise<ContractSummary[]> {
  const rows = await selectRows<ContractSummary>(
    "supplier_contract_summaries",
    (q) => q.eq("organization_id", orgId).order("starts_on", { ascending: false }),
  );
  return rows.filter((row) => row.contract_id);
}

export async function listMealBookings(orgId: string): Promise<MealBookingSummary[]> {
  const rows = await selectRows<MealBookingSummary>(
    "meal_booking_summaries",
    (q) => q.eq("organization_id", orgId).order("service_date", { ascending: false }),
  );
  return rows.filter((row) => row.booking_id);
}

/* ------------------------- contract commands ------------------------- */

export interface NewContractInput {
  supplierId: string;
  contractNumber: string;
  startsOn: string;
  endsOn: string;
  lunchUnitPriceInput: string;
  dinnerUnitPriceInput: string;
  minimumGuests: number;
  cutOffHours: number;
  paymentTerms: string;
  notes: string;
}

export async function createContract(orgId: string, input: NewContractInput): Promise<void> {
  await runRpc("create_supplier_contract", {
    p_org_id: orgId,
    p_supplier_id: input.supplierId,
    p_contract_number: input.contractNumber.trim(),
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_lunch_unit_price: toDbAmount(parseOMR(input.lunchUnitPriceInput)),
    p_dinner_unit_price: toDbAmount(parseOMR(input.dinnerUnitPriceInput)),
    p_minimum_guests: input.minimumGuests,
    p_cut_off_hours: input.cutOffHours,
    p_payment_terms: input.paymentTerms.trim() || null,
    p_notes: input.notes.trim() || null,
    p_idempotency_key: crypto.randomUUID(),
  });
}

export async function endContract(orgId: string, contractId: string): Promise<void> {
  await runRpc("end_supplier_contract", {
    p_org_id: orgId,
    p_contract_id: contractId,
    p_idempotency_key: crypto.randomUUID(),
  });
}

/* ------------------------- booking commands ------------------------- */

export interface NewBookingInput {
  eventId: string;
  supplierId: string;
  mealType: MealType;
  serviceDate: string;
  guestCount: number;
  menuSummary: string;
  notes: string;
}

export async function createMealBooking(orgId: string, input: NewBookingInput): Promise<void> {
  await runRpc("create_meal_booking", {
    p_org_id: orgId,
    p_event_id: input.eventId,
    p_supplier_id: input.supplierId,
    p_meal_type: input.mealType,
    p_service_date: input.serviceDate,
    p_guest_count: input.guestCount,
    p_menu_summary: input.menuSummary.trim() || null,
    p_notes: input.notes.trim() || null,
    p_idempotency_key: crypto.randomUUID(),
  });
}

export async function confirmMealBooking(orgId: string, bookingId: string): Promise<void> {
  await runRpc("confirm_meal_booking", {
    p_org_id: orgId,
    p_booking_id: bookingId,
    p_idempotency_key: crypto.randomUUID(),
  });
}

export async function markMealBookingServed(orgId: string, bookingId: string): Promise<void> {
  await runRpc("mark_meal_booking_served", {
    p_org_id: orgId,
    p_booking_id: bookingId,
    p_idempotency_key: crypto.randomUUID(),
  });
}

export async function cancelMealBooking(
  orgId: string,
  bookingId: string,
  reason: string,
): Promise<void> {
  await runRpc("cancel_meal_booking", {
    p_org_id: orgId,
    p_booking_id: bookingId,
    p_reason: reason.trim(),
    p_idempotency_key: crypto.randomUUID(),
  });
}
