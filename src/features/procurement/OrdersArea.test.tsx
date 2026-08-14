import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrdersArea } from "./OrdersArea";
import {
  createTestSource,
  fullAccess,
  orderFixture,
} from "./__tests__/testDoubles";

const statuses = [
  "DRAFT",
  "APPROVED",
  "SENT",
  "CONFIRMED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;

describe("OrdersArea", () => {
  it("shows loading, empty, and retryable safe error states", async () => {
    const empty = createTestSource({ orders: [] });
    const { rerender } = render(<OrdersArea dataSource={empty.source} access={fullAccess} />);
    expect(screen.getByText("جارٍ تحميل طلبات التوريد…")).toBeInTheDocument();
    expect(await screen.findByText("لا توجد طلبات توريد بعد")).toBeInTheDocument();

    const broken = createTestSource();
    broken.failures.listOrders = new Error("23514 procurement_secret_constraint");
    rerender(<OrdersArea dataSource={broken.source} access={fullAccess} />);
    expect(await screen.findByText("تعذر تحميل الطلبات")).toBeInTheDocument();
    expect(screen.getByText(/حدث خطأ غير متوقع/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("procurement_secret_constraint");
  });

  it("visually distinguishes every authoritative lifecycle state in Arabic", async () => {
    const controls = createTestSource({ orders: statuses.map((status) => orderFixture(status)) });
    render(<OrdersArea dataSource={controls.source} access={fullAccess} />);
    await screen.findByText("PO-DRAFT");
    for (const label of [
      "مسودة",
      "معتمد",
      "مرسل للمورد",
      "مؤكد من المورد",
      "استلام جزئي",
      "تم الاستلام",
      "ملغي",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("order-internal-");
  });

  it("opens partial order detail with ordered, received, remaining, unit and exact OMR", async () => {
    const controls = createTestSource({ orders: [orderFixture("PARTIALLY_RECEIVED")] });
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: "عرض الطلب PO-PARTIALLY_RECEIVED" }));
    const dialog = await screen.findByRole("dialog", { name: "طلب PO-PARTIALLY_RECEIVED" });
    expect(within(dialog).getByText("قهوة عمانية")).toBeInTheDocument();
    expect(within(dialog).getAllByText("الكمية").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("المستلم").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("المتبقي").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("12.350 ر.ع.")).toBeInTheDocument();
    expect(within(dialog).getAllByText("6").length).toBeGreaterThan(0);
  });

  it("uses backend capability and a retry-safe key for approval", async () => {
    const controls = createTestSource({ orders: [orderFixture("DRAFT")] });
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: "عرض الطلب PO-DRAFT" }));
    await user.click(await screen.findByRole("button", { name: "اعتماد الطلب" }));
    expect(screen.getByText("هل تريد اعتماد هذا الطلب؟")).toBeInTheDocument();
    expect(controls.calls.approve).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "نعم، اعتماد الطلب" }));
    await waitFor(() => expect(controls.calls.approve).toHaveBeenCalledWith(
      "order-internal-DRAFT",
      expect.any(String),
    ));
    expect(await screen.findByText("تم اعتماد الطلب بنجاح.")).toBeInTheDocument();
  });

  it("keeps SENT separate from CONFIRMED and exposes both explicit transitions", async () => {
    const approved = createTestSource({ orders: [orderFixture("APPROVED")] });
    const user = userEvent.setup();
    const { unmount } = render(<OrdersArea dataSource={approved.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: "عرض الطلب PO-APPROVED" }));
    const approvedDialog = await screen.findByRole("dialog", { name: "طلب PO-APPROVED" });
    expect(within(approvedDialog).getByRole("button", { name: "تسجيل استلام" })).toBeDisabled();
    await user.click(within(approvedDialog).getByRole("button", { name: "إرسال للمورد" }));
    expect(screen.getByText("هل تم إرسال الطلب فعلياً للمورد؟")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "نعم، إرسال الطلب" }));
    await waitFor(() => expect(approved.calls.send).toHaveBeenCalledWith(
      "order-internal-APPROVED",
      expect.any(String),
    ));
    unmount();

    const sent = createTestSource({ orders: [orderFixture("SENT")] });
    render(<OrdersArea dataSource={sent.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: "عرض الطلب PO-SENT" }));
    const sentDialog = await screen.findByRole("dialog", { name: "طلب PO-SENT" });
    expect(within(sentDialog).getByRole("button", { name: "تسجيل استلام" })).toBeDisabled();
    await user.click(within(sentDialog).getByRole("button", { name: "تأكيد موافقة المورد" }));
    expect(screen.getByText("هل أكد المورد هذا الطلب؟")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "نعم، تأكيد موافقة المورد" }));
    await waitFor(() => expect(sent.calls.confirm).toHaveBeenCalledWith(
      "order-internal-SENT",
      expect.any(String),
    ));
  });

  it.each([
    ["CONFIRMED", "مؤكد من المورد", false],
    ["RECEIVED", "تم الاستلام", true],
  ] as const)("renders %s receiving capability from adapter state", async (status, label, receiveDisabled) => {
    const controls = createTestSource({ orders: [orderFixture(status)] });
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: `عرض الطلب PO-${status}` }));
    const dialog = await screen.findByRole("dialog", { name: `طلب PO-${status}` });
    expect(within(dialog).getAllByText(label).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "تسجيل استلام" })).toHaveProperty("disabled", receiveDisabled);
    if (status === "RECEIVED") expect(within(dialog).getByText("مكتمل")).toBeInTheDocument();
  });

  it("requires an explicit cancellation reason before the S5A command", async () => {
    const controls = createTestSource({ orders: [orderFixture("CONFIRMED")] });
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: "عرض الطلب PO-CONFIRMED" }));
    await user.click(await screen.findByRole("button", { name: "إلغاء الطلب" }));
    expect(screen.getByText("هل تريد إلغاء هذا الطلب؟")).toBeInTheDocument();
    expect(controls.calls.cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "نعم، إلغاء الطلب" }));
    expect(await screen.findByText(/3 أحرف على الأقل/)).toBeInTheDocument();
    expect(controls.calls.cancel).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("سبب الإلغاء"), "المورد تعذر عليه التوريد");
    await user.click(screen.getByRole("button", { name: "نعم، إلغاء الطلب" }));
    await waitFor(() => expect(controls.calls.cancel).toHaveBeenCalledWith(
      "order-internal-CONFIRMED",
      "المورد تعذر عليه التوريد",
      expect.any(String),
    ));
  });

  it("shows cancelled state with all server-disabled actions", async () => {
    const controls = createTestSource({ orders: [orderFixture("CANCELLED")] });
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: "عرض الطلب PO-CANCELLED" }));
    for (const name of ["اعتماد الطلب", "إرسال للمورد", "تأكيد موافقة المورد", "تسجيل استلام", "إلغاء الطلب"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getAllByText(/لا يمكن تنفيذ هذا الإجراء/).length).toBeGreaterThan(0);
  });

  it("does not render or submit confidential amounts without server-derived permission", async () => {
    const controls = createTestSource({ orders: [orderFixture("DRAFT")] });
    const restricted = { ...fullAccess, canViewCommercialAmounts: false };
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={restricted} />);
    await screen.findByText("PO-DRAFT");
    expect(document.body.textContent).not.toContain("12.345 ر.ع.");
    await user.click(screen.getByRole("button", { name: "عرض الطلب PO-DRAFT" }));
    const dialog = await screen.findByRole("dialog", { name: "طلب PO-DRAFT" });
    expect(within(dialog).queryByText("سعر الوحدة")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("الإجمالي")).not.toBeInTheDocument();
  });

  it("creates an exact S5A consumable draft using a tracked catalog item", async () => {
    const controls = createTestSource({ orders: [] });
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={fullAccess} events={[{ id: "event-one", title: "مناسبة تجريبية", eventNumber: "EV-2" }]} />);
    const newButtons = await screen.findAllByRole("button", { name: /طلب جديد|إنشاء أول طلب/ });
    await user.click(newButtons[0]!);

    await user.click(screen.getByRole("button", { name: "إنشاء المسودة" }));
    expect(await screen.findByText("اختر المورد.")).toBeInTheDocument();
    expect(screen.getByText("اختر صنف مخزون معتمداً.")).toBeInTheDocument();
    expect(screen.getByText("أدخل سعر الوحدة المتفق عليه.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/المورد/), "supplier-internal-id");
    await user.selectOptions(screen.getByLabelText("المناسبة (اختياري)"), "event-one");
    await user.type(screen.getByLabelText(/موعد التوريد المتوقع/), "2026-08-20T10:30");
    await user.selectOptions(screen.getByLabelText("صنف المخزون"), "catalog-consumable-water");
    const quantity = screen.getByLabelText(/الكمية/);
    await user.clear(quantity);
    await user.type(quantity, "2.345");
    await user.type(screen.getByLabelText("سعر الوحدة المتفق عليه (ر.ع.)"), "1.001");
    expect(screen.getByText("إجمالي البند: 2.347 ر.ع.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "إنشاء المسودة" }));

    await waitFor(() => expect(controls.calls.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "supplier-internal-id",
      eventId: "event-one",
      orderDate: expect.any(String),
      deliveryDueAt: "2026-08-20T06:30:00.000Z",
      idempotencyKey: expect.any(String),
      lines: [expect.objectContaining({
        catalogItemId: "catalog-consumable-water",
        description: "مياه معدنية",
        unit: "كرتون",
        quantityMilli: 2_345,
        unitCostMilli: 1_001,
      })],
    })));
  });
});
