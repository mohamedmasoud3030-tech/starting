/**
 * Contracted restaurants («المطاعم المتعاقدة») — read models + command types.
 * Column names mirror the 0099 read-model views verbatim; rows arrive through
 * the typed client and are narrowed once in restaurants.db.ts against the
 * generated view row types (`src/lib/dbTypes.ts`).
 */

export type MealType = "LUNCH" | "DINNER";
export type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "SERVED";
export type ContractStatus = "ACTIVE" | "ENDED";

/** Catering supplier master row (member-safe projection). */
export interface RestaurantSupplier {
  supplier_id: string;
  organization_id: string;
  name: string;
  category: "CATERING_RESTAURANT";
  contact_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  status: "ACTIVE" | "INACTIVE";
}

/** supplier_contract_summaries row (cost-gated). */
export interface ContractSummary {
  contract_id: string;
  organization_id: string;
  supplier_id: string;
  supplier_name: string;
  category: "CATERING_RESTAURANT";
  phone: string | null;
  whatsapp: string | null;
  contract_number: string;
  starts_on: string;
  ends_on: string;
  lunch_unit_price: number;
  dinner_unit_price: number;
  minimum_guests: number;
  cut_off_hours: number;
  payment_terms: string | null;
  notes: string | null;
  status: ContractStatus;
  ended_at: string | null;
  currently_valid: boolean;
}

/** meal_booking_summaries row (cost-gated). */
export interface MealBookingSummary {
  booking_id: string;
  organization_id: string;
  event_id: string;
  event_number: string;
  event_title: string;
  supplier_id: string;
  supplier_name: string;
  contract_id: string;
  contract_number: string;
  meal_type: MealType;
  service_date: string;
  guest_count: number;
  unit_price: number;
  total_amount: number;
  menu_summary: string | null;
  notes: string | null;
  status: BookingStatus;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  served_at: string | null;
  created_at: string;
}
