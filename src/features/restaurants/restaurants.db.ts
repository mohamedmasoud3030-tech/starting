import { supabase } from "@/lib/supabase";
import { parseOMR, toDbNumeric } from "@/lib/money";
import type {
  MealBookingSummaryRow,
  SupplierContractSummaryRow,
  SupplierSummaryRow,
} from "@/lib/dbTypes";
import type {
  BookingStatus,
  ContractStatus,
  ContractSummary,
  MealBookingSummary,
  MealType,
  RestaurantSupplier,
} from "./types";

/**
 * Data access for «المطاعم المتعاقدة» (migration 0099).
 *
 * This module goes through the SAME typed Supabase client as every other
 * feature: `src/lib/database.types.ts` covers the 0099 read models
 * (`supplier_summaries`, `supplier_contract_summaries`, `meal_booking_summaries`)
 * and all six command RPCs, so table, column and argument names are checked at
 * compile time and an argument-shape drift fails the build instead of failing
 * silently at runtime.
 *
 * ERROR CONTRACT (binding): a Supabase `error` is ALWAYS thrown. Authorization stays
 * server-side — the views gate by `can_read_cost` and every command re-checks the
 * caller's role and runs on the idempotency register — so a rejection here is a
 * real refusal the operator must see. Swallowing it would close the dialog and
 * reload the list as though the write had succeeded.
 */

/* ------------------------- read-model narrowing ------------------------- */

const MEAL_TYPES: readonly MealType[] = ["LUNCH", "DINNER"];
const BOOKING_STATUSES: readonly BookingStatus[] = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "SERVED",
];
const CONTRACT_STATUSES: readonly ContractStatus[] = ["ACTIVE", "ENDED"];

function mealType(value: string | null): MealType | null {
  return MEAL_TYPES.includes(value as MealType) ? (value as MealType) : null;
}

function bookingStatus(value: string | null): BookingStatus | null {
  return BOOKING_STATUSES.includes(value as BookingStatus)
    ? (value as BookingStatus)
    : null;
}

function contractStatus(value: string | null): ContractStatus | null {
  return CONTRACT_STATUSES.includes(value as ContractStatus)
    ? (value as ContractStatus)
    : null;
}

/**
 * View columns are nullable by construction (PostgreSQL cannot prove view-column
 * nullability), so each row is narrowed once, here. A row missing its identity
 * key — or carrying a lifecycle value this UI has no label for — is skipped
 * rather than rendered as a blank card.
 */
function toRestaurantSupplier(row: SupplierSummaryRow): RestaurantSupplier | null {
  if (!row.supplier_id || !row.organization_id || !row.name) return null;
  if (row.category !== "CATERING_RESTAURANT") return null;
  if (row.status !== "ACTIVE" && row.status !== "INACTIVE") return null;
  return {
    supplier_id: row.supplier_id,
    organization_id: row.organization_id,
    name: row.name,
    category: "CATERING_RESTAURANT",
    contact_name: row.contact_name ?? null,
    phone: row.phone ?? null,
    whatsapp: row.whatsapp ?? null,
    status: row.status,
  };
}

function toContractSummary(row: SupplierContractSummaryRow): ContractSummary | null {
  const status = contractStatus(row.status);
  if (!row.contract_id || !row.organization_id || !row.supplier_id || !status) {
    return null;
  }
  return {
    contract_id: row.contract_id,
    organization_id: row.organization_id,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name ?? "",
    category: "CATERING_RESTAURANT",
    phone: row.phone ?? null,
    whatsapp: row.whatsapp ?? null,
    contract_number: row.contract_number ?? "",
    starts_on: row.starts_on ?? "",
    ends_on: row.ends_on ?? "",
    lunch_unit_price: row.lunch_unit_price ?? 0,
    dinner_unit_price: row.dinner_unit_price ?? 0,
    minimum_guests: row.minimum_guests ?? 0,
    cut_off_hours: row.cut_off_hours ?? 0,
    payment_terms: row.payment_terms ?? null,
    notes: row.notes ?? null,
    status,
    ended_at: row.ended_at ?? null,
    currently_valid: row.currently_valid ?? false,
  };
}

function toMealBookingSummary(row: MealBookingSummaryRow): MealBookingSummary | null {
  const status = bookingStatus(row.status);
  const meal = mealType(row.meal_type);
  if (
    !row.booking_id ||
    !row.organization_id ||
    !row.event_id ||
    !row.supplier_id ||
    !row.contract_id ||
    !status ||
    !meal
  ) {
    return null;
  }
  return {
    booking_id: row.booking_id,
    organization_id: row.organization_id,
    event_id: row.event_id,
    event_number: row.event_number ?? "",
    event_title: row.event_title ?? "",
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name ?? "",
    contract_id: row.contract_id,
    contract_number: row.contract_number ?? "",
    meal_type: meal,
    service_date: row.service_date ?? "",
    guest_count: row.guest_count ?? 0,
    unit_price: row.unit_price ?? 0,
    total_amount: row.total_amount ?? 0,
    menu_summary: row.menu_summary ?? null,
    notes: row.notes ?? null,
    status,
    confirmed_at: row.confirmed_at ?? null,
    cancelled_at: row.cancelled_at ?? null,
    cancellation_reason: row.cancellation_reason ?? null,
    served_at: row.served_at ?? null,
    created_at: row.created_at ?? "",
  };
}

function narrow<T>(rows: Array<T | null>): T[] {
  return rows.filter((row): row is T => row !== null);
}

/* ------------------------- reads ------------------------- */

export async function listCateringRestaurants(
  orgId: string,
): Promise<RestaurantSupplier[]> {
  const { data, error } = await supabase
    .from("supplier_summaries")
    .select("*")
    .eq("organization_id", orgId)
    .eq("category", "CATERING_RESTAURANT")
    .eq("status", "ACTIVE");
  if (error) throw error;
  return narrow((data ?? []).map(toRestaurantSupplier));
}

export async function listContracts(orgId: string): Promise<ContractSummary[]> {
  const { data, error } = await supabase
    .from("supplier_contract_summaries")
    .select("*")
    .eq("organization_id", orgId)
    .order("starts_on", { ascending: false });
  if (error) throw error;
  return narrow((data ?? []).map(toContractSummary));
}

export async function listMealBookings(orgId: string): Promise<MealBookingSummary[]> {
  const { data, error } = await supabase
    .from("meal_booking_summaries")
    .select("*")
    .eq("organization_id", orgId)
    .order("service_date", { ascending: false });
  if (error) throw error;
  return narrow((data ?? []).map(toMealBookingSummary));
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
  const { error } = await supabase.rpc("create_supplier_contract", {
    p_org_id: orgId,
    p_supplier_id: input.supplierId,
    p_contract_number: input.contractNumber.trim(),
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    // numeric(12,3): exact integer milli-OMR in memory, lossless JSON number on
    // the wire (src/lib/money.ts) — the generated Args contract is `number`.
    p_lunch_unit_price: toDbNumeric(parseOMR(input.lunchUnitPriceInput)),
    p_dinner_unit_price: toDbNumeric(parseOMR(input.dinnerUnitPriceInput)),
    p_minimum_guests: input.minimumGuests,
    p_cut_off_hours: input.cutOffHours,
    // The command normalizes with nullif(trim(coalesce(p, '')), ''), so an empty
    // string is persisted as NULL exactly like the previous explicit null.
    p_payment_terms: input.paymentTerms.trim(),
    p_notes: input.notes.trim(),
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw error;
}

export async function endContract(orgId: string, contractId: string): Promise<void> {
  const { error } = await supabase.rpc("end_supplier_contract", {
    p_org_id: orgId,
    p_contract_id: contractId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw error;
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
  const { error } = await supabase.rpc("create_meal_booking", {
    p_org_id: orgId,
    p_event_id: input.eventId,
    p_supplier_id: input.supplierId,
    p_meal_type: input.mealType,
    p_service_date: input.serviceDate,
    p_guest_count: input.guestCount,
    p_menu_summary: input.menuSummary.trim(),
    p_notes: input.notes.trim(),
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw error;
}

export async function confirmMealBooking(orgId: string, bookingId: string): Promise<void> {
  const { error } = await supabase.rpc("confirm_meal_booking", {
    p_org_id: orgId,
    p_booking_id: bookingId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw error;
}

export async function markMealBookingServed(orgId: string, bookingId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_meal_booking_served", {
    p_org_id: orgId,
    p_booking_id: bookingId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw error;
}

export async function cancelMealBooking(
  orgId: string,
  bookingId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("cancel_meal_booking", {
    p_org_id: orgId,
    p_booking_id: bookingId,
    p_reason: reason.trim(),
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw error;
}
