import { supabase } from "@/lib/supabase";
import type { AppRole } from "@/lib/dbTypes";
import { canManageCommercialFor, canReadCostFor } from "@/app/authRoles";
import { fromDbAmount, parseQuantityMilli, toOMRString } from "@/lib/money";
import type {
  Capability,
  CreateProcurementOrderInput,
  EventProcurementSummary,
  OrderCapabilities,
  OrderFilters,
  ProcurementAccess,
  ProcurementConsumableOption,
  ProcurementDataSource,
  ProcurementOrderDetail,
  ProcurementOrderLine,
  ProcurementOrderListItem,
  ProcurementOrderStatus,
  ProcurementReceipt,
  RecordReceiptInput,
  SupplierDetail,
  SupplierFilters,
  SupplierInput,
  SupplierKind,
  SupplierListItem,
  SupplierStatus,
} from "./contracts";
import { ProcurementDomainError } from "./errors";
import * as api from "@/lib/procurement.api";

function deriveOrderCapabilities(
  status: ProcurementOrderStatus,
  role: AppRole | null,
  lines: Array<{
    line_kind?: string | null;
    remaining_quantity?: number | string | null;
    remainingQuantityMilli?: number;
  }>,
): OrderCapabilities {
  const canCommercial = canManageCommercialFor(role);
  const isTerminal = status === "RECEIVED" || status === "CANCELLED";
  const hasRemaining = lines.some((l) => {
    const rem =
      typeof l.remainingQuantityMilli === "number"
        ? l.remainingQuantityMilli
        : parseQuantityMilli(l.remaining_quantity ?? 0);
    return rem > 0;
  });

  const canReceiveRole =
    role === "OWNER" ||
    role === "MANAGER" ||
    role === "SUPERVISOR" ||
    role === "WAREHOUSE";
  const canReceiveStatus =
    status === "CONFIRMED" || status === "PARTIALLY_RECEIVED";
  const warehouseOnlyPhysical =
    role === "WAREHOUSE"
      ? lines.some(
          (l) =>
            l.line_kind === "CONSUMABLE" &&
            (typeof l.remainingQuantityMilli === "number"
              ? l.remainingQuantityMilli > 0
              : parseQuantityMilli(l.remaining_quantity ?? 0) > 0),
        )
      : true;

  return {
    approve: {
      allowed: canCommercial && status === "DRAFT",
      reason: !canCommercial
        ? "PERMISSION_DENIED"
        : status !== "DRAFT"
          ? "INVALID_LIFECYCLE"
          : undefined,
    },
    send: {
      allowed: canCommercial && status === "APPROVED",
      reason: !canCommercial
        ? "PERMISSION_DENIED"
        : status !== "APPROVED"
          ? "INVALID_LIFECYCLE"
          : undefined,
    },
    confirm: {
      allowed: canCommercial && status === "SENT",
      reason: !canCommercial
        ? "PERMISSION_DENIED"
        : status !== "SENT"
          ? "INVALID_LIFECYCLE"
          : undefined,
    },
    cancel: {
      allowed: canCommercial && !isTerminal,
      reason: !canCommercial
        ? "PERMISSION_DENIED"
        : isTerminal
          ? "ORDER_NOT_CANCELLABLE"
          : undefined,
    },
    receive: {
      allowed:
        canReceiveRole &&
        canReceiveStatus &&
        hasRemaining &&
        warehouseOnlyPhysical,
      reason: !canReceiveRole
        ? "PERMISSION_DENIED"
        : !canReceiveStatus
          ? "ITEM_NOT_RECEIVABLE"
          : !hasRemaining
            ? "OVER_RECEIPT"
            : !warehouseOnlyPhysical
              ? "PERMISSION_DENIED"
              : undefined,
    },
  };
}

export function createSupabaseProcurementDataSource(
  organizationId: string,
  role: AppRole | null,
): ProcurementDataSource {
  const canCost = canReadCostFor(role);
  const canCommercial = canManageCommercialFor(role);

  return {
    async getAccess(): Promise<ProcurementAccess> {
      return {
        canViewCommercialAmounts: canCost,
        canCreateSupplier: canCommercial,
        canCreateOrder: canCommercial,
      };
    },

    async listSuppliers(filters?: SupplierFilters): Promise<SupplierListItem[]> {
      const { data: rawSuppliers, error: suppError } = await supabase
        .from("supplier_summaries")
        .select("*")
        .eq("organization_id", organizationId)
        .order("name");
      if (suppError) throw suppError;

      // Fetch orders to calculate openOrderCount and lastOrderAt
      const ordersPromise = canCost
        ? supabase
            .from("procurement_order_summaries")
            .select("supplier_id,status,order_date,created_at")
            .eq("organization_id", organizationId)
        : supabase
            .from("procurement_receiving_order_summaries")
            .select("supplier_id,status,order_date,updated_at")
            .eq("organization_id", organizationId);

      const { data: rawOrders } = await ordersPromise;

      const ordersBySupplier = new Map<
        string,
        Array<{ status: string | null; order_date: string | null }>
      >();
      for (const order of rawOrders ?? []) {
        if (!order.supplier_id) continue;
        const list = ordersBySupplier.get(order.supplier_id) ?? [];
        list.push({ status: order.status, order_date: order.order_date });
        ordersBySupplier.set(order.supplier_id, list);
      }

      let items: SupplierListItem[] = (rawSuppliers ?? []).map((row) => {
        const suppOrders = ordersBySupplier.get(row.supplier_id!) ?? [];
        const openOrderCount = suppOrders.filter(
          (o) => o.status !== "RECEIVED" && o.status !== "CANCELLED",
        ).length;
        const lastOrderAt = suppOrders.reduce(
          (max, o) =>
            o.order_date && (!max || o.order_date > max) ? o.order_date : max,
          null as string | null,
        );

        return {
          id: row.supplier_id!,
          name: row.name ?? "",
          kind: (row.category ?? "GENERAL") as SupplierKind,
          phone: row.phone ?? null,
          status: (row.status ?? "ACTIVE") as SupplierStatus,
          lastOrderAt,
          openOrderCount,
          capabilities: {
            edit: {
              allowed: canCommercial,
              reason: canCommercial ? undefined : "PERMISSION_DENIED",
            },
            deactivate: {
              allowed: canCommercial && row.status === "ACTIVE",
              reason: !canCommercial
                ? "PERMISSION_DENIED"
                : row.status !== "ACTIVE"
                  ? "INVALID_LIFECYCLE"
                  : undefined,
            },
          },
        };
      });

      if (filters?.status && filters.status !== "ALL") {
        items = items.filter((s) => s.status === filters.status);
      }
      if (filters?.kind && filters.kind !== "ALL") {
        items = items.filter((s) => s.kind === filters.kind);
      }
      if (filters?.search) {
        const needle = filters.search.trim().toLocaleLowerCase("ar");
        items = items.filter(
          (s) =>
            s.name.toLocaleLowerCase("ar").includes(needle) ||
            (s.phone ?? "").includes(needle),
        );
      }

      return items;
    },

    async getSupplier(supplierId: string): Promise<SupplierDetail> {
      let contactName: string | null = null;
      let notes: string | null = null;
      let base: SupplierListItem | null = null;

      if (canCost) {
        const { data, error } = await supabase
          .from("supplier_details")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("supplier_id", supplierId)
          .maybeSingle();
        if (error) throw error;
        if (data) {
          contactName = data.contact_name;
          notes = data.notes;
          base = {
            id: data.supplier_id!,
            name: data.name ?? "",
            kind: (data.category ?? "GENERAL") as SupplierKind,
            phone: data.phone ?? null,
            status: (data.status ?? "ACTIVE") as SupplierStatus,
            lastOrderAt: null,
            capabilities: {
              edit: {
                allowed: canCommercial,
                reason: canCommercial ? undefined : "PERMISSION_DENIED",
              },
              deactivate: {
                allowed: canCommercial && data.status === "ACTIVE",
                reason: !canCommercial
                  ? "PERMISSION_DENIED"
                  : data.status !== "ACTIVE"
                    ? "INVALID_LIFECYCLE"
                    : undefined,
              },
            },
          };
        }
      }

      if (!base) {
        const { data, error } = await supabase
          .from("supplier_summaries")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("supplier_id", supplierId)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new ProcurementDomainError("NOT_FOUND");

        contactName = data.contact_name;
        base = {
          id: data.supplier_id!,
          name: data.name ?? "",
          kind: (data.category ?? "GENERAL") as SupplierKind,
          phone: data.phone ?? null,
          status: (data.status ?? "ACTIVE") as SupplierStatus,
          lastOrderAt: null,
          capabilities: {
            edit: {
              allowed: canCommercial,
              reason: canCommercial ? undefined : "PERMISSION_DENIED",
            },
            deactivate: {
              allowed: canCommercial && data.status === "ACTIVE",
              reason: !canCommercial
                ? "PERMISSION_DENIED"
                : data.status !== "ACTIVE"
                  ? "INVALID_LIFECYCLE"
                  : undefined,
            },
          },
        };
      }

      return {
        ...base,
        contactName,
        notes,
      };
    },

    async createSupplier(input: SupplierInput): Promise<SupplierDetail> {
      const created = await api.createSupplier(organizationId, {
        name: input.name,
        category: input.kind,
        contactName: input.contactName,
        phone: input.phone,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
      });
      return this.getSupplier(created.id);
    },

    async updateSupplier(
      supplierId: string,
      input: SupplierInput,
    ): Promise<SupplierDetail> {
      await api.updateSupplier(organizationId, supplierId, {
        name: input.name,
        category: input.kind,
        contactName: input.contactName,
        phone: input.phone,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
      });
      return this.getSupplier(supplierId);
    },

    async deactivateSupplier(
      supplierId: string,
      idempotencyKey: string,
    ): Promise<SupplierDetail> {
      await api.setSupplierStatus(
        organizationId,
        supplierId,
        "INACTIVE",
        idempotencyKey,
      );
      return this.getSupplier(supplierId);
    },

    async listConsumableOptions(): Promise<ProcurementConsumableOption[]> {
      const { data, error } = await supabase
        .from("consumable_stock_summary")
        .select("catalog_item_id,item_name,item_unit")
        .eq("organization_id", organizationId)
        .eq("is_tracking_active", true)
        .eq("catalog_status", "ACTIVE");
      if (error) throw error;

      return (data ?? [])
        .filter((r) => r.catalog_item_id != null)
        .map((r) => ({
          id: r.catalog_item_id!,
          name: r.item_name ?? "",
          unit: r.item_unit ?? "",
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "ar"));
    },

    async listOrders(
      filters?: OrderFilters,
    ): Promise<ProcurementOrderListItem[]> {
      const [ordersRes, linesRes] = await Promise.all([
        canCost
          ? supabase
              .from("procurement_order_summaries")
              .select("*")
              .eq("organization_id", organizationId)
              .order("order_date", { ascending: false })
          : supabase
              .from("procurement_receiving_order_summaries")
              .select("*")
              .eq("organization_id", organizationId)
              .order("order_date", { ascending: false }),
        canCost
          ? supabase
              .from("procurement_order_line_summaries")
              .select("order_id,line_kind,remaining_quantity")
              .eq("organization_id", organizationId)
          : supabase
              .from("procurement_receiving_line_summaries")
              .select("order_id,line_kind,remaining_quantity")
              .eq("organization_id", organizationId),
      ]);

      if (ordersRes.error) throw ordersRes.error;
      if (linesRes.error) throw linesRes.error;

      const linesByOrder = new Map<
        string,
        Array<{
          line_kind?: string | null;
          remaining_quantity?: number | string | null;
        }>
      >();
      for (const line of linesRes.data ?? []) {
        if (!line.order_id) continue;
        const list = linesByOrder.get(line.order_id) ?? [];
        list.push({
          line_kind: line.line_kind,
          remaining_quantity: line.remaining_quantity,
        });
        linesByOrder.set(line.order_id, list);
      }

      let orders: ProcurementOrderListItem[] = (ordersRes.data ?? []).map(
        (row) => {
          const orderLines = linesByOrder.get(row.order_id!) ?? [];
          const status = row.status as ProcurementOrderStatus;
          const isTerminal = status === "RECEIVED" || status === "CANCELLED";
          const outstandingCount = isTerminal
            ? 0
            : orderLines.filter(
                (l) => parseQuantityMilli(l.remaining_quantity ?? 0) > 0,
              ).length;

          const negotiatedTotalMilli =
            canCost &&
            "agreed_total_cost" in row &&
            row.agreed_total_cost != null
              ? fromDbAmount(row.agreed_total_cost)
              : null;

          return {
            id: row.order_id!,
            orderNumber: row.order_number ?? "",
            supplier: {
              id: row.supplier_id!,
              name: row.supplier_name ?? "",
            },
            event: row.event_id
              ? {
                  id: row.event_id,
                  title: row.event_title ?? "",
                  eventNumber: row.event_number ?? null,
                }
              : null,
            orderedAt:
            row.order_date ??
            ("created_at" in row && row.created_at
              ? row.created_at
              : row.updated_at ?? ""),
            deliveryDueAt: row.expected_delivery_at ?? null,
            status,
            negotiatedTotalMilli,
            outstandingDeliveryCount: outstandingCount,
            capabilities: deriveOrderCapabilities(status, role, orderLines),
          };
        },
      );

      if (filters?.eventId) {
        orders = orders.filter((o) => o.event?.id === filters.eventId);
      }
      if (filters?.status && filters.status !== "ALL") {
        orders = orders.filter((o) => o.status === filters.status);
      }
      if (filters?.search) {
        const needle = filters.search.trim().toLocaleLowerCase("ar");
        orders = orders.filter((o) => {
          const haystack =
            `${o.orderNumber} ${o.supplier.name} ${o.event?.title ?? ""}`.toLocaleLowerCase(
              "ar",
            );
          return haystack.includes(needle);
        });
      }

      return orders;
    },

    async getOrder(orderId: string): Promise<ProcurementOrderDetail> {
      if (canCost) {
        const detail = await api.getProcurementOrderDetail(
          organizationId,
          orderId,
        );
        const order = detail.order;
        const status = order.status as ProcurementOrderStatus;

        const { data: receiptLines } = await supabase
          .from("procurement_receipt_line_summaries")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("order_id", orderId);

        const receiptLinesByReceipt = new Map<
          string,
          Array<{ order_line_id: string | null; quantity: number | null }>
        >();
        for (const rl of receiptLines ?? []) {
          if (!rl.receipt_id) continue;
          const list = receiptLinesByReceipt.get(rl.receipt_id) ?? [];
          list.push({
            order_line_id: rl.order_line_id,
            quantity: rl.quantity,
          });
          receiptLinesByReceipt.set(rl.receipt_id, list);
        }

        const receipts: ProcurementReceipt[] = detail.receipts.map((r) => ({
          id: r.receipt_id!,
          receiptNumber: r.reference ?? null,
          receivedAt: r.received_at ?? r.created_at ?? "",
          lines: (receiptLinesByReceipt.get(r.receipt_id!) ?? []).map((rl) => ({
            orderLineId: rl.order_line_id!,
            quantityMilli: parseQuantityMilli(rl.quantity ?? 0),
          })),
        }));

        const lines: ProcurementOrderLine[] = detail.lines.map((l) => {
          const orderedMilli = parseQuantityMilli(l.ordered_quantity ?? 0);
          const receivedMilli = parseQuantityMilli(l.received_quantity ?? 0);
          const remainingMilli = parseQuantityMilli(l.remaining_quantity ?? 0);

          let receiveAllowed = false;
          let receiveReason: Capability["reason"] = undefined;

          if (remainingMilli <= 0) {
            receiveAllowed = false;
          } else if (status !== "CONFIRMED" && status !== "PARTIALLY_RECEIVED") {
            receiveAllowed = false;
            receiveReason = "ITEM_NOT_RECEIVABLE";
          } else if (role === "ACCOUNTANT") {
            receiveAllowed = false;
            receiveReason = "PERMISSION_DENIED";
          } else if (role === "WAREHOUSE" && l.line_kind !== "CONSUMABLE") {
            receiveAllowed = false;
            receiveReason = "PERMISSION_DENIED";
          } else {
            receiveAllowed = true;
          }

          return {
            id: l.order_line_id!,
            description: l.description ?? "",
            kind: l.line_kind as any,
            catalogItemId: l.catalog_item_id,
            unit: l.unit ?? "",
            orderedQuantityMilli: orderedMilli,
            receivedQuantityMilli: receivedMilli,
            remainingQuantityMilli: remainingMilli,
            unitCostMilli: fromDbAmount(l.agreed_unit_cost),
            lineTotalMilli: fromDbAmount(l.agreed_total_cost),
            receive: {
              allowed: receiveAllowed,
              reason: receiveReason,
            },
          };
        });

        const isTerminal = status === "RECEIVED" || status === "CANCELLED";
        const outstandingCount = isTerminal
          ? 0
          : lines.filter((l) => l.remainingQuantityMilli > 0).length;

        return {
          id: order.order_id!,
          orderNumber: order.order_number ?? "",
          supplier: {
            id: order.supplier_id!,
            name: order.supplier_name ?? "",
          },
          event: order.event_id
            ? {
                id: order.event_id,
                title: order.event_title ?? "",
                eventNumber: order.event_number ?? null,
              }
            : null,
          orderedAt: order.order_date ?? order.created_at ?? "",
          deliveryDueAt: order.expected_delivery_at ?? null,
          status,
          negotiatedTotalMilli: fromDbAmount(order.agreed_total_cost),
          outstandingDeliveryCount: outstandingCount,
          capabilities: deriveOrderCapabilities(status, role, lines),
          notes: order.notes ?? null,
          lines,
          receipts,
        };
      } else {
        // Cost-free path for WAREHOUSE / SUPERVISOR
        const [orderRes, linesRes, receiptsRes, receiptLinesRes] =
          await Promise.all([
            supabase
              .from("procurement_receiving_order_summaries")
              .select("*")
              .eq("organization_id", organizationId)
              .eq("order_id", orderId)
              .single(),
            supabase
              .from("procurement_receiving_line_summaries")
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
            supabase
              .from("procurement_receipt_line_summaries")
              .select("*")
              .eq("organization_id", organizationId)
              .eq("order_id", orderId),
          ]);

        if (orderRes.error) throw orderRes.error;
        if (linesRes.error) throw linesRes.error;
        if (receiptsRes.error) throw receiptsRes.error;

        const order = orderRes.data;
        const status = order.status as ProcurementOrderStatus;

        const receiptLinesByReceipt = new Map<
          string,
          Array<{ order_line_id: string | null; quantity: number | null }>
        >();
        for (const rl of receiptLinesRes.data ?? []) {
          if (!rl.receipt_id) continue;
          const list = receiptLinesByReceipt.get(rl.receipt_id) ?? [];
          list.push({
            order_line_id: rl.order_line_id,
            quantity: rl.quantity,
          });
          receiptLinesByReceipt.set(rl.receipt_id, list);
        }

        const receipts: ProcurementReceipt[] = (receiptsRes.data ?? []).map(
          (r) => ({
            id: r.receipt_id!,
            receiptNumber: r.reference ?? null,
            receivedAt: r.received_at ?? r.created_at ?? "",
            lines: (receiptLinesByReceipt.get(r.receipt_id!) ?? []).map(
              (rl) => ({
                orderLineId: rl.order_line_id!,
                quantityMilli: parseQuantityMilli(rl.quantity ?? 0),
              }),
            ),
          }),
        );

        const lines: ProcurementOrderLine[] = (linesRes.data ?? []).map((l) => {
          const orderedMilli = parseQuantityMilli(l.ordered_quantity ?? 0);
          const receivedMilli = parseQuantityMilli(l.received_quantity ?? 0);
          const remainingMilli = parseQuantityMilli(l.remaining_quantity ?? 0);

          let receiveAllowed = false;
          let receiveReason: Capability["reason"] = undefined;

          if (remainingMilli <= 0) {
            receiveAllowed = false;
          } else if (status !== "CONFIRMED" && status !== "PARTIALLY_RECEIVED") {
            receiveAllowed = false;
            receiveReason = "ITEM_NOT_RECEIVABLE";
          } else if (role === "ACCOUNTANT") {
            receiveAllowed = false;
            receiveReason = "PERMISSION_DENIED";
          } else if (role === "WAREHOUSE" && l.line_kind !== "CONSUMABLE") {
            receiveAllowed = false;
            receiveReason = "PERMISSION_DENIED";
          } else {
            receiveAllowed = true;
          }

          return {
            id: l.order_line_id!,
            description: l.description ?? "",
            kind: l.line_kind as any,
            catalogItemId: l.catalog_item_id,
            unit: l.unit ?? "",
            orderedQuantityMilli: orderedMilli,
            receivedQuantityMilli: receivedMilli,
            remainingQuantityMilli: remainingMilli,
            unitCostMilli: null,
            lineTotalMilli: null,
            receive: {
              allowed: receiveAllowed,
              reason: receiveReason,
            },
          };
        });

        const isTerminal = status === "RECEIVED" || status === "CANCELLED";
        const outstandingCount = isTerminal
          ? 0
          : lines.filter((l) => l.remainingQuantityMilli > 0).length;

        return {
          id: order.order_id!,
          orderNumber: order.order_number ?? "",
          supplier: {
            id: order.supplier_id!,
            name: order.supplier_name ?? "",
          },
          event: order.event_id
            ? {
                id: order.event_id,
                title: order.event_title ?? "",
                eventNumber: order.event_number ?? null,
              }
            : null,
          orderedAt: order.order_date ?? order.updated_at ?? "",
          deliveryDueAt: order.expected_delivery_at ?? null,
          status,
          negotiatedTotalMilli: null,
          outstandingDeliveryCount: outstandingCount,
          capabilities: deriveOrderCapabilities(status, role, lines),
          notes: null,
          lines,
          receipts,
        };
      }
    },

    async createOrder(
      input: CreateProcurementOrderInput,
    ): Promise<ProcurementOrderDetail> {
      const created = await api.createProcurementOrder(organizationId, {
        supplierId: input.supplierId,
        eventId: input.eventId,
        orderDate: input.orderDate,
        expectedDeliveryAt: input.deliveryDueAt,
        notes: input.notes,
        lines: input.lines.map((l) => ({
          lineKind: l.kind,
          catalogItemId: l.catalogItemId,
          description: l.description,
          unit: l.unit,
          quantity: toOMRString(l.quantityMilli),
          agreedUnitCost: toOMRString(l.unitCostMilli),
        })),
        idempotencyKey: input.idempotencyKey,
      });
      return this.getOrder(created.id);
    },

    async approveOrder(
      orderId: string,
      idempotencyKey: string,
    ): Promise<ProcurementOrderDetail> {
      await api.transitionProcurementOrder(
        "approve_procurement_order",
        organizationId,
        orderId,
        idempotencyKey,
      );
      return this.getOrder(orderId);
    },

    async sendOrder(
      orderId: string,
      idempotencyKey: string,
    ): Promise<ProcurementOrderDetail> {
      await api.transitionProcurementOrder(
        "send_procurement_order",
        organizationId,
        orderId,
        idempotencyKey,
      );
      return this.getOrder(orderId);
    },

    async confirmOrder(
      orderId: string,
      idempotencyKey: string,
    ): Promise<ProcurementOrderDetail> {
      await api.transitionProcurementOrder(
        "confirm_procurement_order",
        organizationId,
        orderId,
        idempotencyKey,
      );
      return this.getOrder(orderId);
    },

    async cancelOrder(
      orderId: string,
      reason: string,
      idempotencyKey: string,
    ): Promise<ProcurementOrderDetail> {
      await api.cancelProcurementOrder(
        organizationId,
        orderId,
        reason,
        idempotencyKey,
      );
      return this.getOrder(orderId);
    },

    async recordReceipt(input: RecordReceiptInput): Promise<ProcurementReceipt> {
      const receiptRow = await api.receiveProcurementOrder(
        organizationId,
        input.orderId,
        {
          receivedAt: input.receivedAt,
          reference: input.reference,
          notes: input.notes,
          lines: input.lines.map((l) => ({
            orderLineId: l.orderLineId,
            quantity: toOMRString(l.quantityMilli),
          })),
          idempotencyKey: input.idempotencyKey,
        },
      );

      return {
        id: receiptRow.id,
        receiptNumber: receiptRow.reference ?? null,
        receivedAt: receiptRow.received_at,
        lines: input.lines,
      };
    },

    async getEventProcurement(
      eventId: string,
    ): Promise<EventProcurementSummary> {
      const orders = await this.listOrders({ eventId });
      const outstandingDeliveryCount = orders.reduce(
        (sum, o) => sum + o.outstandingDeliveryCount,
        0,
      );

      let negotiatedTotalMilli: number | null = null;
      if (canCost) {
        const costSummary = await api.getEventProcurementCostSummary(
          organizationId,
          eventId,
        );
        if (costSummary && costSummary.active_committed_cost != null) {
          negotiatedTotalMilli = fromDbAmount(costSummary.active_committed_cost);
        } else {
          negotiatedTotalMilli = orders.reduce(
            (sum, o) => sum + (o.negotiatedTotalMilli ?? 0),
            0,
          );
        }
      }

      return {
        eventId,
        orders,
        outstandingDeliveryCount,
        negotiatedTotalMilli,
      };
    },
  };
}
