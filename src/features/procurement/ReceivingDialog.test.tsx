import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReceivingDialog } from "./ReceivingDialog";
import { createTestSource, orderFixture } from "./__tests__/testDoubles";

describe("ReceivingDialog", () => {
  it("records a partial physical receipt with exact quantity and a request key", async () => {
    const controls = createTestSource();
    const order = orderFixture("PARTIALLY_RECEIVED");
    const user = userEvent.setup();
    render(<ReceivingDialog open order={order} dataSource={controls.source} onOpenChange={() => {}} onReceived={() => {}} />);

    expect(screen.getAllByText("المطلوب").length).toBeGreaterThan(0);
    expect(screen.getAllByText("المستلم").length).toBeGreaterThan(0);
    expect(screen.getAllByText("المتبقي").length).toBeGreaterThan(0);
    const quantity = screen.getByLabelText("الكمية المستلمة الآن (كجم)");
    await user.type(quantity, "2.345");
    await user.click(screen.getByRole("button", { name: "مراجعة الاستلام" }));
    expect(screen.getByText("استلام مواد")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تأكيد الاستلام" }));

    await waitFor(() => expect(controls.calls.receipt).toHaveBeenCalledWith(expect.objectContaining({
      orderId: "order-internal-PARTIALLY_RECEIVED",
      lines: [{ orderLineId: "line-consumable-internal", quantityMilli: 2_345 }],
      idempotencyKey: expect.any(String),
    })));
    expect(await screen.findByText("تم حفظ الاستلام بنجاح")).toBeInTheDocument();
  });

  it("supports full receipt for physical and catering/service lines with one tap", async () => {
    const controls = createTestSource();
    const order = orderFixture("CONFIRMED");
    const user = userEvent.setup();
    render(<ReceivingDialog open order={order} dataSource={controls.source} onOpenChange={() => {}} onReceived={() => {}} />);

    expect(screen.getByLabelText("الكمية المسلّمة الآن (خدمة)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تحديد كل المتبقي" }));
    expect(screen.getByLabelText("الكمية المستلمة الآن (كجم)")).toHaveValue("10");
    expect(screen.getByLabelText("الكمية المسلّمة الآن (خدمة)")).toHaveValue("1");
    await user.click(screen.getByRole("button", { name: "مراجعة الاستلام" }));
    expect(screen.getByText("تأكيد تسليم خدمة")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تأكيد الاستلام" }));

    await waitFor(() => expect(controls.calls.receipt).toHaveBeenCalledWith(expect.objectContaining({
      lines: [
        { orderLineId: "line-consumable-internal", quantityMilli: 10_000 },
        { orderLineId: "line-service-internal", quantityMilli: 1_000 },
      ],
    })));
  });

  it("blocks over-receipt locally and never calls the adapter", async () => {
    const controls = createTestSource();
    const order = orderFixture("PARTIALLY_RECEIVED");
    const user = userEvent.setup();
    render(<ReceivingDialog open order={order} dataSource={controls.source} onOpenChange={() => {}} onReceived={() => {}} />);

    await user.type(screen.getByLabelText("الكمية المستلمة الآن (كجم)"), "6.001");
    await user.click(screen.getByRole("button", { name: "مراجعة الاستلام" }));
    expect(await screen.findByText("الكمية أكبر من المتبقي (6).")).toBeInTheDocument();
    expect(controls.calls.receipt).not.toHaveBeenCalled();
  });

  it("retains the same idempotency key for a retry with the same payload", async () => {
    const controls = createTestSource();
    const order = orderFixture("CONFIRMED", { lines: [orderFixture("CONFIRMED").lines[0]!] });
    const attempts: string[] = [];
    const original = controls.source.recordReceipt;
    controls.source.recordReceipt = vi.fn(async (input) => {
      attempts.push(input.idempotencyKey);
      if (attempts.length === 1) throw new Error("NETWORK_ERROR");
      return original(input);
    });
    const user = userEvent.setup();
    render(<ReceivingDialog open order={order} dataSource={controls.source} onOpenChange={() => {}} onReceived={() => {}} />);

    await user.click(screen.getByRole("button", { name: "تحديد كل المتبقي" }));
    await user.click(screen.getByRole("button", { name: "مراجعة الاستلام" }));
    await user.click(screen.getByRole("button", { name: "تأكيد الاستلام" }));
    expect(await screen.findByText(/يمكنك إعادة المحاولة بأمان/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findByText("تم حفظ الاستلام بنجاح");
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toBe(attempts[1]);
  });

  it("uses large mobile-safe controls instead of a wide table", () => {
    const controls = createTestSource();
    render(<ReceivingDialog open order={orderFixture("CONFIRMED")} dataSource={controls.source} onOpenChange={() => {}} onReceived={() => {}} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تحديد كل المتبقي" })).toHaveClass("h-12");
    expect(screen.getByText(/لا تعدّل الرصيد مباشرة/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("line-consumable-internal");
  });
});
