import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HistoryTab } from "./HistoryTab";

const history = [
  {
    id: 1,
    from_status: "RETURNING",
    to_status: "CLOSED",
    reason: null,
    created_at: "2026-08-20T18:00:00+04:00",
  },
];

describe("HistoryTab — Arabic audit labels", () => {
  it("translates known audit actions for the owner", () => {
    render(
      <HistoryTab
        history={history}
        audit={[
          {
            id: 10,
            action: "EVENT_CANCELLED",
            entity: "event",
            entity_id: "ev-1",
            created_at: "2026-08-20T17:00:00+04:00",
          },
          {
            id: 11,
            action: "CUSTOMER_PAYMENT_RECORDED",
            entity: "customer_payment",
            entity_id: "pay-1",
            created_at: "2026-08-20T16:00:00+04:00",
          },
        ]}
      />,
    );

    expect(screen.getByText("إلغاء المناسبة")).toBeInTheDocument();
    expect(screen.getByText("تسجيل دفعة عميل")).toBeInTheDocument();
    // The raw code remains visible as the auditable identifier.
    expect(screen.getByText("EVENT_CANCELLED")).toBeInTheDocument();
  });

  it("keeps unknown audit actions visible instead of hiding them", () => {
    render(
      <HistoryTab
        history={history}
        audit={[
          {
            id: 12,
            action: "FUTURE_UNKNOWN_ACTION",
            entity: "event",
            entity_id: "ev-1",
            created_at: "2026-08-20T15:00:00+04:00",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("FUTURE_UNKNOWN_ACTION")).toHaveLength(2);
  });
});
