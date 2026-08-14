import type { MilliOMR } from "@/lib/money";

/**
 * Frontend-only S5 integration contract.
 *
 * This is deliberately a UI-facing anti-corruption layer: components know
 * nothing about Supabase, tables, views, RPC names, or generated database
 * types. The S5A adapter must map its authoritative read models and commands
 * into these shapes after the backend contract is published.
 */

export type SupplierStatus = "ACTIVE" | "INACTIVE";
export type SupplierKind =
  | "CONSUMABLES"
  | "CATERING"
  | "SERVICES"
  | "EQUIPMENT"
  | "OTHER";

export type ProcurementOrderStatus =
  | "DRAFT"
  | "APPROVED"
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
  | "ORDER_ALREADY_CANCELLED"
  | "OVER_RECEIPT"
  | "INVALID_LIFECYCLE"
  | "PERMISSION_DENIED"
  | "IDEMPOTENCY_MISMATCH"
  | "SUPPLIER_NOT_AVAILABLE"
  | "ITEM_NOT_RECEIVABLE"
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
  cancel: Capability;
  receive: Capability;
}

export interface SupplierListItem {
  id: string;
  name: string;
  kind: SupplierKind;
  phone: string | null;
  status: SupplierStatus;
  lastOrderAt: string | null;
  openOrderCount?: number | null;
  capabilities: SupplierCapabilities;
}

export interface SupplierDetail extends SupplierListItem {
  contactName: string | null;
  notes: string | null;
}

export interface ProcurementOrderListItem {
  id: string;
  orderNumber: string;
  supplier: { id: string; name: string };
  event: { id: string; title: string; eventNumber?: string | null } | null;
  orderedAt: string;
  deliveryDueAt: string;
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
  contactName: string | null;
  notes: string | null;
}

export interface ProcurementOrderLineInput {
  description: string;
  kind: ProcurementLineKind;
  unit: string;
  quantityMilli: QuantityMilli;
  /** Exact integer milli-OMR; omitted when price is not entered/authorized. */
  unitCostMilli?: MilliOMR | null;
}

export interface CreateProcurementOrderInput {
  supplierId: string;
  eventId: string | null;
  deliveryDueAt: string;
  notes: string | null;
  lines: ProcurementOrderLineInput[];
}

export interface RecordReceiptInput {
  orderId: string;
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
 * Implemented only by the later S5A integration adapter. No production
 * persistence implementation belongs in the S5B frontend slice.
 */
export interface ProcurementDataSource {
  getAccess(): Promise<ProcurementAccess>;

  listSuppliers(filters?: SupplierFilters): Promise<SupplierListItem[]>;
  getSupplier(supplierId: string): Promise<SupplierDetail>;
  createSupplier(input: SupplierInput): Promise<SupplierDetail>;
  updateSupplier(supplierId: string, input: SupplierInput): Promise<SupplierDetail>;
  deactivateSupplier(supplierId: string): Promise<SupplierDetail>;

  listOrders(filters?: OrderFilters): Promise<ProcurementOrderListItem[]>;
  getOrder(orderId: string): Promise<ProcurementOrderDetail>;
  createOrder(input: CreateProcurementOrderInput): Promise<ProcurementOrderDetail>;
  approveOrder(orderId: string): Promise<ProcurementOrderDetail>;
  cancelOrder(orderId: string): Promise<ProcurementOrderDetail>;
  recordReceipt(input: RecordReceiptInput): Promise<ProcurementReceipt>;

  getEventProcurement(eventId: string): Promise<EventProcurementSummary>;
}

export interface ProcurementEventOption {
  id: string;
  title: string;
  eventNumber?: string | null;
}
