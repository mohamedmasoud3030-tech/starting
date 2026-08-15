/**
 * S5A Supabase adapter.
 *
 * Raw procurement tables are intentionally not queried here: reads use the
 * stable RLS-scoped projections published by migration 0031/0034, and every
 * write uses a server-authoritative SECURITY DEFINER command with an idempotency key.
 * Quantities and OMR values enter line JSON as exact 3-decimal strings; the
 * database rejects excess precision and performs all persisted arithmetic.
 */
import { supabase } from "./supabase";
import type {
  FunctionArgs,
  ProcurementLineKind,
  ProcurementOrderDetailRow,
  ProcurementOrderLineSummaryRow,
  ProcurementOrderRow,
  ProcurementOrderSummaryRow,
  ProcurementReceiptRow,
  ProcurementReceiptSummaryRow,
  ProcurementReceiptLineSummaryRow,
  ProcurementReceivingLineSummaryRow,
  ProcurementReceivingOrderSummaryRow,
  SupplierCategory,
  SupplierDetailRow,
  SupplierRow,
  SupplierStatus,
  SupplierSummaryRow,
  EventProcurementCostSummaryRow,
} from "./dbTypes";

/** Generated PostgREST args do not encode SQL parameter nullability. */
function nullableDbArg<T>(value: T | null): T {
  return value as T;
}

function optionalText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function exactDecimal(value: string): string {
  const normalized = value.trim();
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(normalized)) {
    throw new Error("Exact decimal must be non-negative with at most 3 decimals");
  }
  return normalized;
}

async function resultOrThrow<T>(result: {
  data: T | null;
  error: unknown;
}): Promise<T> {
  if (result.error) throw result.error;
  if (result.data === null) throw new Error("Supabase returned no command/read result");
  return result.data;
}

export interface SupplierCommandInput {
  name: string;
  category: SupplierCategory;
  commercialRegistrationNumber?: string | null;
  contactName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  notes?: string | null;
  idempotencyKey: string;
}

export async function listSupplierSummaries(
  organizationId: string,
): Promise<SupplierSummaryRow[]> {
  return resultOrThrow(
    await supabase
      .from("supplier_summaries")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name"),
  );
}

export async function getSupplierDetail(
  organizationId: string,
  supplierId: string,
): Promise<SupplierDetailRow | null> {
  const result = await supabase
    .from("supplier_details")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("supplier_id", supplierId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

export async function createSupplier(
  organizationId: string,
  input: SupplierCommandInput,
): Promise<SupplierRow> {
  const args: FunctionArgs<"create_supplier"> = {
    p_org_id: organizationId,
    p_name: input.name.trim(),
    p_category: input.category,
    p_commercial_registration_number: optionalText(
      input.commercialRegistrationNumber,
    ),
    p_contact_name: optionalText(input.contactName),
    p_phone: optionalText(input.phone),
    p_whatsapp: optionalText(input.whatsapp),
    p_email: optionalText(input.email),
    p_notes: optionalText(input.notes),
    p_idempotency_key: input.idempotencyKey,
  };
  return resultOrThrow(await supabase.rpc("create_supplier", args));
}

export async function updateSupplier(
  organizationId: string,
  supplierId: string,
  input: SupplierCommandInput,
): Promise<SupplierRow> {
  const args: FunctionArgs<"update_supplier"> = {
    p_org_id: organizationId,
    p_supplier_id: supplierId,
    p_name: input.name.trim(),
    p_category: input.category,
    p_commercial_registration_number: optionalText(
      input.commercialRegistrationNumber,
    ),
    p_contact_name: optionalText(input.contactName),
    p_phone: optionalText(input.phone),
    p_whatsapp: optionalText(input.whatsapp),
    p_email: optionalText(input.email),
    p_notes: optionalText(input.notes),
    p_idempotency_key: input.idempotencyKey,
  };
  return resultOrThrow(await supabase.rpc("update_supplier", args));
}

export async function setSupplierStatus(
  organizationId: string,
  supplierId: string,
  status: SupplierStatus,
  idempotencyKey: string,
): Promise<SupplierRow> {
  const args: FunctionArgs<"set_supplier_status"> = {
    p_org_id: organizationId,
    p_supplier_id: supplierId,
    p_status: status,
    p_idempotency_key: idempotencyKey,
  };
  return resultOrThrow(await supabase.rpc("set_supplier_status", args));
}

export interface ProcurementDraftLineInput {
  lineKind: ProcurementLineKind;
  catalogItemId?: string | null;
  description?: string;
  unit?: string;
  /** Positive exact decimal text, maximum 3 fractional digits. */
  quantity: string;
  /** Non-negative exact OMR decimal text, maximum 3 fractional digits. */
  agreedUnitCost: string;
}

export interface ProcurementDraftInput {
  supplierId: string;
  eventId?: string | null;
  orderDate: string;
  expectedDeliveryAt?: string | null;
  notes?: string | null;
  lines: ProcurementDraftLineInput[];
  idempotencyKey: string;
}

function draftLinesPayload(lines: ProcurementDraftLineInput[]) {
  return lines.map((line) => ({
    line_kind: line.lineKind,
    catalog_item_id: line.catalogItemId ?? null,
    description: optionalText(line.description),
    unit: optionalText(line.unit),
    quantity: exactDecimal(line.quantity),
    agreed_unit_cost: exactDecimal(line.agreedUnitCost),
  }));
}

export async function listProcurementOrders(
  organizationId: string,
): Promise<ProcurementOrderSummaryRow[]> {
  return resultOrThrow(
    await supabase
      .from("procurement_order_summaries")
      .select("*")
      .eq("organization_id", organizationId)
      .order("order_date", { ascending: false }),
  );
}

export async function listReceivingOrders(
  organizationId: string,
): Promise<ProcurementReceivingOrderSummaryRow[]> {
  return resultOrThrow(
    await supabase
      .from("procurement_receiving_order_summaries")
      .select("*")
      .eq("organization_id", organizationId)
      .order("order_date", { ascending: false }),
  );
}

export interface ProcurementOrderDetailContract {
  order: ProcurementOrderDetailRow;
  lines: ProcurementOrderLineSummaryRow[];
  receipts: ProcurementReceiptSummaryRow[];
}

export async function getProcurementOrderDetail(
  organizationId: string,
  orderId: string,
): Promise<ProcurementOrderDetailContract> {
  const [orderResult, linesResult, receiptsResult] = await Promise.all([
    supabase
      .from("procurement_order_details")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("order_id", orderId)
      .single(),
    supabase
      .from("procurement_order_line_summaries")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("order_id", orderId)
      .order("sort_order"),
    supabase
      .from("procurement_receipt_summaries")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("order_id", orderId)
      .order("received_at", { ascending: false }),
  ]);
  if (orderResult.error) throw orderResult.error;
  if (linesResult.error) throw linesResult.error;
  if (receiptsResult.error) throw receiptsResult.error;
  return {
    order: orderResult.data,
    lines: linesResult.data,
    receipts: receiptsResult.data,
  };
}

export async function listReceivingLines(
  organizationId: string,
  orderId: string,
): Promise<ProcurementReceivingLineSummaryRow[]> {
  return resultOrThrow(
    await supabase
      .from("procurement_receiving_line_summaries")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("order_id", orderId)
      .order("sort_order"),
  );
}

export async function listProcurementReceiptLines(
  organizationId: string,
  receiptId: string,
): Promise<ProcurementReceiptLineSummaryRow[]> {
  return resultOrThrow(
    await supabase
      .from("procurement_receipt_line_summaries")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("receipt_id", receiptId),
  );
}

export async function createProcurementOrder(
  organizationId: string,
  input: ProcurementDraftInput,
): Promise<ProcurementOrderRow> {
  const args: FunctionArgs<"create_procurement_order"> = {
    p_org_id: organizationId,
    p_supplier_id: input.supplierId,
    p_event_id: nullableDbArg(input.eventId ?? null),
    p_order_date: input.orderDate,
    p_expected_delivery_at: nullableDbArg(input.expectedDeliveryAt ?? null),
    p_notes: optionalText(input.notes),
    p_lines: draftLinesPayload(input.lines),
    p_idempotency_key: input.idempotencyKey,
  };
  return resultOrThrow(await supabase.rpc("create_procurement_order", args));
}

export async function updateProcurementOrder(
  organizationId: string,
  orderId: string,
  input: ProcurementDraftInput,
): Promise<ProcurementOrderRow> {
  const args: FunctionArgs<"update_procurement_order"> = {
    p_org_id: organizationId,
    p_order_id: orderId,
    p_supplier_id: input.supplierId,
    p_event_id: nullableDbArg(input.eventId ?? null),
    p_order_date: input.orderDate,
    p_expected_delivery_at: nullableDbArg(input.expectedDeliveryAt ?? null),
    p_notes: optionalText(input.notes),
    p_lines: draftLinesPayload(input.lines),
    p_idempotency_key: input.idempotencyKey,
  };
  return resultOrThrow(await supabase.rpc("update_procurement_order", args));
}

type OrderTransitionName =
  | "approve_procurement_order"
  | "send_procurement_order"
  | "confirm_procurement_order";

export async function transitionProcurementOrder(
  command: OrderTransitionName,
  organizationId: string,
  orderId: string,
  idempotencyKey: string,
): Promise<ProcurementOrderRow> {
  const args = {
    p_org_id: organizationId,
    p_order_id: orderId,
    p_idempotency_key: idempotencyKey,
  };
  if (command === "approve_procurement_order") {
    return resultOrThrow(await supabase.rpc(command, args));
  }
  if (command === "send_procurement_order") {
    return resultOrThrow(await supabase.rpc(command, args));
  }
  return resultOrThrow(await supabase.rpc(command, args));
}

export async function cancelProcurementOrder(
  organizationId: string,
  orderId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ProcurementOrderRow> {
  const args: FunctionArgs<"cancel_procurement_order"> = {
    p_org_id: organizationId,
    p_order_id: orderId,
    p_reason: reason.trim(),
    p_idempotency_key: idempotencyKey,
  };
  return resultOrThrow(await supabase.rpc("cancel_procurement_order", args));
}

export interface ProcurementReceiptLineInput {
  orderLineId: string;
  quantity: string;
}

export interface ProcurementReceiptInput {
  receivedAt: string;
  reference?: string | null;
  notes?: string | null;
  lines: ProcurementReceiptLineInput[];
  idempotencyKey: string;
}

export async function receiveProcurementOrder(
  organizationId: string,
  orderId: string,
  input: ProcurementReceiptInput,
): Promise<ProcurementReceiptRow> {
  const args: FunctionArgs<"receive_procurement_order"> = {
    p_org_id: organizationId,
    p_order_id: orderId,
    p_received_at: input.receivedAt,
    p_reference: optionalText(input.reference),
    p_notes: optionalText(input.notes),
    p_lines: input.lines.map((line) => ({
      order_line_id: line.orderLineId,
      quantity: exactDecimal(line.quantity),
    })),
    p_idempotency_key: input.idempotencyKey,
  };
  return resultOrThrow(await supabase.rpc("receive_procurement_order", args));
}

export async function getEventProcurementCostSummary(
  organizationId: string,
  eventId: string,
): Promise<EventProcurementCostSummaryRow | null> {
  const result = await supabase
    .from("event_procurement_cost_summaries")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}
