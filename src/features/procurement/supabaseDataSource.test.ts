import { describe, expect, it, vi, beforeEach } from "vitest";
import { supabase } from "@/lib/supabase";
import { createSupabaseProcurementDataSource } from "./supabaseDataSource";

vi.mock("@/lib/supabase", () => {
  const from = vi.fn();
  const rpc = vi.fn();
  return {
    supabase: {
      from,
      rpc,
    },
  };
});

describe("createSupabaseProcurementDataSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAccess", () => {
    it("grants commercial visibility and creation to OWNER and MANAGER", async () => {
      const ownerSource = createSupabaseProcurementDataSource("org-1", "OWNER");
      expect(await ownerSource.getAccess()).toEqual({
        canViewCommercialAmounts: true,
        canCreateSupplier: true,
        canCreateOrder: true,
      });

      const managerSource = createSupabaseProcurementDataSource("org-1", "MANAGER");
      expect(await managerSource.getAccess()).toEqual({
        canViewCommercialAmounts: true,
        canCreateSupplier: true,
        canCreateOrder: true,
      });
    });

    it("grants cost visibility to ACCOUNTANT without creation rights", async () => {
      const accountantSource = createSupabaseProcurementDataSource("org-1", "ACCOUNTANT");
      expect(await accountantSource.getAccess()).toEqual({
        canViewCommercialAmounts: true,
        canCreateSupplier: false,
        canCreateOrder: false,
      });
    });

    it("restricts commercial visibility and creation for WAREHOUSE and SUPERVISOR", async () => {
      const warehouseSource = createSupabaseProcurementDataSource("org-1", "WAREHOUSE");
      expect(await warehouseSource.getAccess()).toEqual({
        canViewCommercialAmounts: false,
        canCreateSupplier: false,
        canCreateOrder: false,
      });

      const supervisorSource = createSupabaseProcurementDataSource("org-1", "SUPERVISOR");
      expect(await supervisorSource.getAccess()).toEqual({
        canViewCommercialAmounts: false,
        canCreateSupplier: false,
        canCreateOrder: false,
      });
    });
  });

  describe("listSuppliers", () => {
    it("returns mapped suppliers with open order counts and capabilities", async () => {
      const mockSuppliers = [
        {
          supplier_id: "sup-1",
          name: "شركة التموين",
          category: "CATERING_RESTAURANT",
          phone: "99000001",
          status: "ACTIVE",
        },
        {
          supplier_id: "sup-2",
          name: "مورد مواد قديم",
          category: "CONSUMABLES",
          phone: "99000002",
          status: "INACTIVE",
        },
      ];

      const mockOrders = [
        { supplier_id: "sup-1", status: "CONFIRMED", order_date: "2026-08-10" },
        { supplier_id: "sup-1", status: "RECEIVED", order_date: "2026-08-01" },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === "supplier_summaries") {
          return {
            select: () => ({
              eq: () => ({
                order: () => Promise.resolve({ data: mockSuppliers, error: null }),
              }),
            }),
          } as any;
        }
        if (table === "procurement_order_summaries") {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: mockOrders, error: null }),
            }),
          } as any;
        }
        return {} as any;
      });

      const source = createSupabaseProcurementDataSource("org-1", "OWNER");
      const suppliers = await source.listSuppliers();

      expect(suppliers).toHaveLength(2);
      expect(suppliers[0]).toMatchObject({
        id: "sup-1",
        name: "شركة التموين",
        kind: "CATERING_RESTAURANT",
        status: "ACTIVE",
        openOrderCount: 1,
        lastOrderAt: "2026-08-10",
        capabilities: {
          edit: { allowed: true },
          deactivate: { allowed: true },
        },
      });
      expect(suppliers[1]?.capabilities.deactivate.allowed).toBe(false);
    });
  });

  describe("getSupplier", () => {
    it("reads full supplier details including notes and CRN when authorized", async () => {
      const mockDetail = {
        supplier_id: "sup-1",
        name: "شركة التموين",
        category: "CATERING_RESTAURANT",
        phone: "99000001",
        contact_name: "سالم",
        notes: "ملاحظات تجارية",
        commercial_registration_number: "CR-12345",
        status: "ACTIVE",
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === "supplier_details") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: mockDetail, error: null }),
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const source = createSupabaseProcurementDataSource("org-1", "OWNER");
      const supplier = await source.getSupplier("sup-1");

      expect(supplier).toMatchObject({
        id: "sup-1",
        name: "شركة التموين",
        contactName: "سالم",
        commercialRegistrationNumber: "CR-12345",
        notes: "ملاحظات تجارية",
      });
    });

    it("reads cost-free supplier summary without notes when not authorized", async () => {
      const mockSummary = {
        supplier_id: "sup-1",
        name: "شركة التموين",
        category: "CATERING_RESTAURANT",
        phone: "99000001",
        contact_name: "سالم",
        status: "ACTIVE",
      };

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === "supplier_summaries") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: mockSummary, error: null }),
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const source = createSupabaseProcurementDataSource("org-1", "WAREHOUSE");
      const supplier = await source.getSupplier("sup-1");

      expect(supplier).toMatchObject({
        id: "sup-1",
        name: "شركة التموين",
        contactName: "سالم",
        notes: null,
      });
    });
  });

  describe("listOrders and getOrder", () => {
    it("maps exact quantities and costs without floating point corruption", async () => {
      const mockOrderRow = {
        order_id: "ord-1",
        order_number: "PO-2026-00001",
        supplier_id: "sup-1",
        supplier_name: "شركة التموين",
        event_id: "ev-1",
        event_number: "EV-001",
        event_title: "حفل زفاف",
        order_date: "2026-08-14",
        expected_delivery_at: "2026-08-15T10:00:00+04:00",
        notes: "تعليمات التسليم",
        status: "CONFIRMED",
        agreed_total_cost: 15.5,
      };

      const mockLines = [
        {
          order_line_id: "line-1",
          order_id: "ord-1",
          line_kind: "CONSUMABLE",
          catalog_item_id: "cat-1",
          description: "قهوة عمانية",
          unit: "كجم",
          ordered_quantity: 10,
          received_quantity: 4.125,
          remaining_quantity: 5.875,
          agreed_unit_cost: 1.55,
          agreed_total_cost: 15.5,
        },
      ];

      const mockReceipts = [
        {
          receipt_id: "rc-1",
          order_id: "ord-1",
          reference: "DN-101",
          received_at: "2026-08-14T11:00:00+04:00",
        },
      ];

      const mockReceiptLines = [
        {
          receipt_id: "rc-1",
          order_id: "ord-1",
          order_line_id: "line-1",
          quantity: 4.125,
        },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === "procurement_order_details") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () => Promise.resolve({ data: mockOrderRow, error: null }),
                }),
              }),
            }),
          } as any;
        }
        if (table === "procurement_order_line_summaries") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => Promise.resolve({ data: mockLines, error: null }),
                }),
              }),
            }),
          } as any;
        }
        if (table === "procurement_receipt_summaries") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => Promise.resolve({ data: mockReceipts, error: null }),
                }),
              }),
            }),
          } as any;
        }
        if (table === "procurement_receipt_line_summaries") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ data: mockReceiptLines, error: null }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const source = createSupabaseProcurementDataSource("org-1", "OWNER");
      const order = await source.getOrder("ord-1");

      expect(order.id).toBe("ord-1");
      expect(order.negotiatedTotalMilli).toBe(15_500);
      expect(order.outstandingDeliveryCount).toBe(1);
      expect(order.lines[0]).toMatchObject({
        orderedQuantityMilli: 10_000,
        receivedQuantityMilli: 4_125,
        remainingQuantityMilli: 5_875,
        unitCostMilli: 1_550,
        lineTotalMilli: 15_500,
        receive: { allowed: true },
      });
      expect(order.receipts[0]).toMatchObject({
        receiptNumber: "DN-101",
        lines: [{ orderLineId: "line-1", quantityMilli: 4_125 }],
      });
    });
  });

  describe("createOrder and recordReceipt mutations", () => {
    it("formats 3-decimal strings and idempotency keys correctly", async () => {
      vi.mocked(supabase.rpc).mockImplementation((fn: string) => {
        if (fn === "create_procurement_order") {
          return Promise.resolve({ data: { id: "new-ord-1" }, error: null }) as any;
        }
        if (fn === "receive_procurement_order") {
          return Promise.resolve({
            data: { id: "rc-new", reference: "REC-1", received_at: "2026-08-14T10:00:00Z" },
            error: null,
          }) as any;
        }
        return Promise.resolve({ data: null, error: null }) as any;
      });

      vi.mocked(supabase.from).mockImplementation(() => {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({
                  data: {
                    order_id: "new-ord-1",
                    status: "DRAFT",
                    supplier_id: "sup-1",
                    supplier_name: "مورد",
                  },
                  error: null,
                }),
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        } as any;
      });

      const source = createSupabaseProcurementDataSource("org-1", "OWNER");

      await source.createOrder({
        supplierId: "sup-1",
        eventId: "ev-1",
        orderDate: "2026-08-14",
        deliveryDueAt: null,
        notes: "ملاحظات",
        lines: [
          {
            kind: "CONSUMABLE",
            catalogItemId: "cat-1",
            description: "سكر",
            unit: "كجم",
            quantityMilli: 2_500,
            unitCostMilli: 1_250,
          },
        ],
        idempotencyKey: "idem-key-1",
      });

      expect(supabase.rpc).toHaveBeenCalledWith("create_procurement_order", {
        p_org_id: "org-1",
        p_supplier_id: "sup-1",
        p_event_id: "ev-1",
        p_order_date: "2026-08-14",
        p_expected_delivery_at: null,
        p_notes: "ملاحظات",
        p_lines: [
          {
            line_kind: "CONSUMABLE",
            catalog_item_id: "cat-1",
            description: "سكر",
            unit: "كجم",
            quantity: "2.500",
            agreed_unit_cost: "1.250",
          },
        ],
        p_idempotency_key: "idem-key-1",
      });

      await source.recordReceipt({
        orderId: "new-ord-1",
        receivedAt: "2026-08-14T10:00:00Z",
        reference: "REC-1",
        notes: "تم الفحص",
        lines: [{ orderLineId: "line-1", quantityMilli: 2_500 }],
        idempotencyKey: "idem-rc-1",
      });

      expect(supabase.rpc).toHaveBeenCalledWith("receive_procurement_order", {
        p_org_id: "org-1",
        p_order_id: "new-ord-1",
        p_received_at: "2026-08-14T10:00:00Z",
        p_reference: "REC-1",
        p_notes: "تم الفحص",
        p_lines: [
          {
            order_line_id: "line-1",
            quantity: "2.500",
          },
        ],
        p_idempotency_key: "idem-rc-1",
      });
    });

    it("passes CRN, email, whatsapp to createSupplier and updateSupplier RPCs", async () => {
      vi.mocked(supabase.rpc).mockImplementation((fn: string) => {
        if (fn === "create_supplier") {
          return Promise.resolve({ data: { id: "new-sup-1" }, error: null }) as any;
        }
        if (fn === "update_supplier") {
          return Promise.resolve({ data: { id: "sup-1" }, error: null }) as any;
        }
        return Promise.resolve({ data: null, error: null }) as any;
      });

      vi.mocked(supabase.from).mockImplementation(() => {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({
                  data: {
                    supplier_id: "new-sup-1",
                    name: "مورد",
                    category: "GENERAL",
                    status: "ACTIVE",
                    commercial_registration_number: "CR-12345",
                    email: "info@supplier.om",
                    whatsapp: "99001122",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        } as any;
      });

      const source = createSupabaseProcurementDataSource("org-1", "OWNER");

      await source.createSupplier({
        name: "مورد جديد",
        kind: "CATERING_RESTAURANT",
        commercialRegistrationNumber: "CR-12345",
        contactName: "أحمد",
        phone: "99001122",
        whatsapp: "99001122",
        email: "info@supplier.om",
        notes: "ملاحظات",
        idempotencyKey: "idem-sup-create",
      });

      expect(supabase.rpc).toHaveBeenCalledWith("create_supplier", {
        p_org_id: "org-1",
        p_name: "مورد جديد",
        p_category: "CATERING_RESTAURANT",
        p_commercial_registration_number: "CR-12345",
        p_contact_name: "أحمد",
        p_phone: "99001122",
        p_whatsapp: "99001122",
        p_email: "info@supplier.om",
        p_notes: "ملاحظات",
        p_idempotency_key: "idem-sup-create",
      });

      await source.updateSupplier("sup-1", {
        name: "مورد معدل",
        kind: "CATERING_RESTAURANT",
        commercialRegistrationNumber: "CR-99999",
        contactName: "سالم",
        phone: "99003344",
        whatsapp: "99003344",
        email: "salem@supplier.om",
        notes: "ملاحظات معدلة",
        idempotencyKey: "idem-sup-update",
      });

      expect(supabase.rpc).toHaveBeenCalledWith("update_supplier", {
        p_org_id: "org-1",
        p_supplier_id: "sup-1",
        p_name: "مورد معدل",
        p_category: "CATERING_RESTAURANT",
        p_commercial_registration_number: "CR-99999",
        p_contact_name: "سالم",
        p_phone: "99003344",
        p_whatsapp: "99003344",
        p_email: "salem@supplier.om",
        p_notes: "ملاحظات معدلة",
        p_idempotency_key: "idem-sup-update",
      });
    });
  });
});
