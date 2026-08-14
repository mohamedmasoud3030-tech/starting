import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventProcurementPanel } from "./EventProcurementPanel";
import {
  createTestSource,
  fullAccess,
  orderFixture,
} from "./__tests__/testDoubles";

describe("EventProcurementPanel", () => {
  it("shows Event orders, status, negotiated amount, received state, and outstanding deliveries", async () => {
    const order = orderFixture("PARTIALLY_RECEIVED");
    const controls = createTestSource({
      eventSummary: {
        eventId: "event-internal-id",
        orders: [order],
        outstandingDeliveryCount: 1,
        negotiatedTotalMilli: 12_345,
      },
    });
    render(<EventProcurementPanel eventId="event-internal-id" dataSource={controls.source} access={fullAccess} />);

    expect(await screen.findByText("التوريدات والموردون")).toBeInTheDocument();
    expect(screen.getByText("استلام جزئي")).toBeInTheDocument();
    expect(screen.getByText("1 توريدات متبقية")).toBeInTheDocument();
    expect(screen.getAllByText(/12.345 ر.ع./).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("event-internal-id");
  });

  it("never renders negotiated amounts for restricted access even if a bad adapter supplies them", async () => {
    const controls = createTestSource();
    render(<EventProcurementPanel eventId="event-internal-id" dataSource={controls.source} access={{ ...fullAccess, canViewCommercialAmounts: false }} />);
    await screen.findByText("التوريدات والموردون");
    expect(document.body.textContent).not.toContain("المبلغ المتفق عليه");
    expect(document.body.textContent).not.toContain("12.345 ر.ع.");
  });

  it("renders empty/error states and supports an integration-owned order action", async () => {
    const empty = createTestSource({
      eventSummary: { eventId: "event-internal-id", orders: [], outstandingDeliveryCount: 0 },
    });
    const { rerender } = render(<EventProcurementPanel eventId="event-internal-id" dataSource={empty.source} access={fullAccess} />);
    expect(await screen.findByText("لا توجد طلبات توريد لهذه المناسبة")).toBeInTheDocument();

    const broken = createTestSource();
    broken.failures.getEventProcurement = new Error("PERMISSION_DENIED raw policy");
    rerender(<EventProcurementPanel eventId="event-internal-id" dataSource={broken.source} access={fullAccess} />);
    expect(await screen.findByText("تعذر تحميل توريدات المناسبة")).toBeInTheDocument();
    expect(screen.getByText("لا تملك صلاحية تنفيذ هذا الإجراء.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("raw policy");

    const usable = createTestSource();
    const opened: string[] = [];
    rerender(<EventProcurementPanel eventId="event-internal-id" dataSource={usable.source} access={fullAccess} onOrderOpen={(id) => opened.push(id)} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /فتح الطلب/ }));
    expect(opened).toEqual(["order-internal-DRAFT"]);
  });
});
