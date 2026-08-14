import type { MilliOMR } from "@/lib/money";

/**
 * Frontend-only S5 integration contract.
 *
 * Components know nothing about Supabase/RPC names. The production adapter
 * maps the authoritative S5A read models and command responses into these
 * shapes. Enum values intentionally match S5A so the adapter never performs
 * lossy lifecycle/category translation.
 */

export type SupplierStatus = "ACTIVE" | "INACTIVE";
export type SupplierKind =
  | "CATERING_RESTAURANT"
  | "CONSUMABLES"
  | "EQUIPMENT_RENTAL"
  | "GENERAL";

export type ProcurementOrderStatus =
  | "DRAFT"
  | "APPROVED"
  | "SENT"
  | "CONFIRMED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

export type ProcurementLineKind = "CONSUMABLE" | "CATERING_SERVICE" | "OTHER";

/** Exact quantity in integer milli-units (1 unit = 1000). */
export type QuantityMilli = number;

export type ProcurementDomainErrorCode =
  | "SUPPLIER_INACTIVE"
  | "ORDER_NOT_EDITABLE"
  | "ORDER_NOT_CANCELLABLE"
  | "OVER_RECEIPT"
  | "INVALID_LIFECYCLE"
  | "PERMISSION_DENIED"
  | "IDEMPOTENCY_MISMATCH"
  | "SUPPLIER_NOT_AVAILABLE"
  | "ITEM_NOT_RECEIVABLE"
  | "CANCELLATION_REASON_REQUIRED"
  | "CATALOG_ITEM_REQUIRED"
  | "TRACKING_INACTIVE"
  | "NETWORK_ERROR"
  | "NOT_FOUND"
  | "UNKNOWN";

export interface Capability {
  allowed: boolean;
  /** Backend-provided reason code. React never derives lifecycle truth. */
  reason?: ProcurementDomainErrorCode;
}

export interface ProcurementAccess {
  /** Must reflect a cost-filtered backend response, not a client role guess. */
  canViewCommercialAmounts: boolean;
  canCreateSupplier: boolean;
  canCreateOrder: boolean;
}

export interface SupplierCapabilities {
  edit: Capability;
  deactivate: Capability;
}

export interface OrderCapabilities {
  approve: Capability;
  send: Capability;
  confirm: Capability;
  cancel: Capability;
  receive: Capability;
}

export interface SupplierListItem {
  id: string;
  name: string;
  kind: SupplierKind;
  phone: string | null;
  whatsapp?: string | null;
  status: SupplierStatus;
  lastOrderAt: string | null;
  openOrderCount?: number | null;
  capabilities: SupplierCapabilities;
}

export interface SupplierDetail extends SupplierListItem {
  contactName: string | null;
  commercialRegistrationNumber: string | null;
  email: string | null;
  notes: string | null;
}

export interface ProcurementOrderListItem {
  id: string;
  orderNumber: string;
  supplier: { id: string; name: string };
  event: { id: string; title: string; eventNumber?: string | null } | null;
  orderedAt: string;
  deliveryDueAt: string | null;
  status: ProcurementOrderStatus;
  /** Omitted/null when the backend does not authorize commercial visibility. */
  negotiatedTotalMilli?: MilliOMR | null;
  outstandingDeliveryCount: number;
  capabilities: OrderCapabilities;
}

export interface ProcurementOrderLine {
  id: string;
  description: string;
  kind: ProcurementLineKind;
  catalogItemId?: string | null;
  unit: string;
  orderedQuantityMilli: QuantityMilli;
  receivedQuantityMilli: QuantityMilli;
  /** Supplied by S5A. The UI does not derive authoritative remaining stock. */
  remainingQuantityMilli: QuantityMilli;
  unitCostMilli?: MilliOMR | null;
  lineTotalMilli?: MilliOMR | null;
  receive: Capability;
}

export interface ProcurementReceipt {
  id: string;
  receiptNumber?: string | null;
  receivedAt: string;
  lines: Array<{
    orderLineId: string;
    quantityMilli: QuantityMilli;
  }>;
}

export interface ProcurementOrderDetail extends ProcurementOrderListItem {
  notes: string | null;
  lines: ProcurementOrderLine[];
  receipts: ProcurementReceipt[];
}

export interface EventProcurementSummary {
  eventId: string;
  orders: ProcurementOrderListItem[];
  outstandingDeliveryCount: number;
  /** Omitted/null unless S5A explicitly grants commercial visibility. */
  negotiatedTotalMilli?: MilliOMR | null;
}

export interface SupplierInput {
  name: string;
  kind: SupplierKind;
  phone: string | null;
  whatsapp?: string | null;
  email?: string | null;
  commercialRegistrationNumber?: string | null;
  contactName: string | null;
  notes: string | null;
  idempotencyKey: string;
}

export interface ProcurementConsumableOption {
  id: string;
  name: string;
  unit: string;
}

export interface ProcurementOrderLineInput {
  catalogItemId?: string | null;
  description: string;
  kind: ProcurementLineKind;
  unit: string;
  quantityMilli: QuantityMilli;
  /** Exact integer milli-OMR. S5A requires an explicit negotiated cost. */
  unitCostMilli: MilliOMR;
}

export interface CreateProcurementOrderInput {
  supplierId: string;
  eventId: string | null;
  orderDate: string;
  deliveryDueAt: string | null;
  notes: string | null;
  lines: ProcurementOrderLineInput[];
  idempotencyKey: string;
}

export interface RecordReceiptInput {
  orderId: string;
  receivedAt: string;
  reference: string | null;
  lines: Array<{ orderLineId: string; quantityMilli: QuantityMilli }>;
  notes: string | null;
  idempotencyKey: string;
}

export interface SupplierFilters {
  search?: string;
  status?: SupplierStatus | "ALL";
  kind?: SupplierKind | "ALL";
}

export interface OrderFilters {
  search?: string;
  status?: ProcurementOrderStatus | "ALL";
  eventId?: string;
}

/**
 * Implemented by the S5 integration adapter. Mutations carry an idempotency key
 * from the operator intent so an ambiguous network failure can retry the exact
 * same request safely.
 */
export interface ProcurementDataSource {
  getAccess(): Promise<ProcurementAccess>;

  listSuppliers(filters?: SupplierFilters): Promise<SupplierListItem[]>;
  getSupplier(supplierId: string): Promise<SupplierDetail>;
  createSupplier(input: SupplierInput): Promise<SupplierDetail>;
  updateSupplier(supplierId: string, input: SupplierInput): Promise<SupplierDetail>;
  deactivateSupplier(supplierId: string, idempotencyKey: string): Promise<SupplierDetail>;

  listConsumableOptions(): Promise<ProcurementConsumableOption[]>;
  listOrders(filters?: OrderFilters): Promise<ProcurementOrderListItem[]>;
  getOrder(orderId: string): Promise<ProcurementOrderDetail>;
  createOrder(input: CreateProcurementOrderInput): Promise<ProcurementOrderDetail>;
  approveOrder(orderId: string, idempotencyKey: string): Promise<ProcurementOrderDetail>;
  sendOrder(orderId: string, idempotencyKey: string): Promise<ProcurementOrderDetail>;
  confirmOrder(orderId: string, idempotencyKey: string): Promise<ProcurementOrderDetail>;
  cancelOrder(orderId: string, reason: string, idempotencyKey: string): Promise<ProcurementOrderDetail>;
  recordReceipt(input: RecordReceiptInput): Promise<ProcurementReceipt>;

  getEventProcurement(eventId: string): Promise<EventProcurementSummary>;
}

export interface ProcurementEventOption {
  id: string;
  title: string;
  eventNumber?: string | null;
}
