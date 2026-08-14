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

  it("visually distinguishes every lifecycle state in Arabic", async () => {
    const controls = createTestSource({ orders: statuses.map((status) => orderFixture(status)) });
    render(<OrdersArea dataSource={controls.source} access={fullAccess} />);
    await screen.findByText("PO-DRAFT");
    for (const label of ["مسودة", "معتمد", "مؤكد / مرسل", "استلام جزئي", "تم الاستلام", "ملغي"]) {
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

  it("uses backend capabilities and confirms approval rather than deriving a transition", async () => {
    const controls = createTestSource({ orders: [orderFixture("DRAFT")] });
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: "عرض الطلب PO-DRAFT" }));
    await user.click(await screen.findByRole("button", { name: "اعتماد الطلب" }));
    expect(screen.getByText("هل تريد اعتماد هذا الطلب؟")).toBeInTheDocument();
    expect(controls.calls.approve).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "نعم، اعتماد الطلب" }));
    await waitFor(() => expect(controls.calls.approve).toHaveBeenCalledWith("order-internal-DRAFT"));
    expect(await screen.findByText("تم اعتماد الطلب بنجاح.")).toBeInTheDocument();
  });

  it.each([
    ["APPROVED", "معتمد", false],
    ["RECEIVED", "تم الاستلام", true],
  ] as const)("renders %s order detail from adapter state", async (status, label, receiveDisabled) => {
    const controls = createTestSource({ orders: [orderFixture(status)] });
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: `عرض الطلب PO-${status}` }));
    const dialog = await screen.findByRole("dialog", { name: `طلب PO-${status}` });
    expect(within(dialog).getAllByText(label).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "تسجيل استلام" })).toHaveProperty("disabled", receiveDisabled);
    if (status === "RECEIVED") expect(within(dialog).getByText("مكتمل")).toBeInTheDocument();
  });

  it("requires explicit confirmation before cancellation", async () => {
    const controls = createTestSource({ orders: [orderFixture("CONFIRMED")] });
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: "عرض الطلب PO-CONFIRMED" }));
    await user.click(await screen.findByRole("button", { name: "إلغاء الطلب" }));
    expect(screen.getByText("هل تريد إلغاء هذا الطلب؟")).toBeInTheDocument();
    expect(controls.calls.cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "نعم، إلغاء الطلب" }));
    await waitFor(() => expect(controls.calls.cancel).toHaveBeenCalledWith("order-internal-CONFIRMED"));
  });

  it("shows cancelled state with server-disabled actions and an Arabic reason", async () => {
    const controls = createTestSource({ orders: [orderFixture("CANCELLED")] });
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: "عرض الطلب PO-CANCELLED" }));
    expect(await screen.findByRole("button", { name: "اعتماد الطلب" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "تسجيل استلام" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "إلغاء الطلب" })).toBeDisabled();
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

  it("validates then creates an exact order draft through the adapter", async () => {
    const controls = createTestSource({ orders: [] });
    const user = userEvent.setup();
    render(<OrdersArea dataSource={controls.source} access={fullAccess} events={[{ id: "event-one", title: "مناسبة تجريبية", eventNumber: "EV-2" }]} />);
    const newButtons = await screen.findAllByRole("button", { name: /طلب جديد|إنشاء أول طلب/ });
    await user.click(newButtons[0]!);

    await user.click(screen.getByRole("button", { name: "إنشاء المسودة" }));
    expect(await screen.findByText("اختر المورد.")).toBeInTheDocument();
    expect(screen.getByText("حدد تاريخ ووقت التوريد.")).toBeInTheDocument();
    expect(screen.getByText("وصف البند مطلوب.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/المورد/), "supplier-internal-id");
    await user.selectOptions(screen.getByLabelText("المناسبة (اختياري)"), "event-one");
    await user.type(screen.getByLabelText(/موعد التوريد/), "2026-08-20T10:30");
    await user.type(screen.getByLabelText(/وصف البند/), "مياه معدنية");
    const quantity = screen.getByLabelText(/الكمية/);
    await user.clear(quantity);
    await user.type(quantity, "2.345");
    await user.type(screen.getByLabelText("سعر الوحدة (ر.ع.)"), "1.001");
    expect(screen.getByText("إجمالي البند: 2.347 ر.ع.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "إنشاء المسودة" }));

    await waitFor(() => expect(controls.calls.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      supplierId: "supplier-internal-id",
      eventId: "event-one",
      lines: [expect.objectContaining({ quantityMilli: 2_345, unitCostMilli: 1_001 })],
    })));
  });
});
