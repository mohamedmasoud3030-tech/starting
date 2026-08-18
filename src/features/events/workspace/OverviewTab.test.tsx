import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EventRow, EventStatus } from "../events.api";
import type { ReadinessReport } from "../readinessReport";
import { OverviewTab } from "./OverviewTab";

const readyReport: ReadinessReport = {
  items: [],
  percent: null,
  overall: "EMPTY",
  staffMissing: 0,
  equipmentShortage: 0,
};

function event(status: EventStatus): EventRow {
  return {
    id: "ev-1",
    organization_id: "org",
    customer_id: "cu-1",
    event_number: "EV-2026-00001",
    title: "مناسبة قاعة الريان",
    event_type: "زفاف",
    start_at: "2026-08-20T16:00:00+04:00",
    end_at: "2026-08-20T22:00:00+04:00",
    guest_count: 120,
    venue_name: "قاعة الريان",
    location_details: null,
    contact_name: null,
    contact_phone: null,
    notes: null,
    status,
    cancellation_reason: null,
    accepted_quotation_id: null,
    created_at: "2026-08-10T00:00:00Z",
  };
}

const run = vi.fn().mockResolvedValue(undefined);
const onOpenTab = vi.fn();

function renderOverview(
  status: EventStatus,
  extras: Partial<Parameters<typeof OverviewTab>[0]> = {},
) {
  return render(
    <OverviewTab
      event={event(status)}
      customerName="مريم"
      canCommercial={true}
      canFinance={true}
      run={run}
      report={readyReport}
      history={[]}
      acceptedQuote={null}
      financiallyClosed={false}
      onOpenTab={onOpenTab}
      {...extras}
    />,
  );
}

describe("OverviewTab — lifecycle controls", () => {
  beforeEach(() => {
    run.mockClear();
  });

  it("offers one next step per status until CLOSED (full journey restored)", async () => {
    const steps: ReadonlyArray<readonly [EventStatus, string, string]> = [
      ["CONFIRMED", "PREPARING", "بدء التجهيز"],
      ["PREPARING", "DISPATCHED", "تأكيد الإرسال"],
      ["DISPATCHED", "IN_PROGRESS", "بدء التنفيذ"],
      ["IN_PROGRESS", "RETURNING", "بدء العودة والإرجاع"],
      ["RETURNING", "CLOSED", "إغلاق المناسبة"],
    ];
    for (const [status, target, label] of steps) {
      run.mockClear();
      renderOverview(status);
      await userEvent.click(screen.getByRole("button", { name: label }));
      expect(run).toHaveBeenCalledWith("transition_event_status", {
        p_to: target,
        p_reason: null,
        p_override_reason: null,
      });
    }
  });

  it("offers no next step for CLOSED or CANCELLED events", () => {
    for (const status of ["CLOSED", "CANCELLED"] as const) {
      renderOverview(status);
      expect(
        screen.queryByRole("button", { name: /بدء|تأكيد|إغلاق/ }),
      ).not.toBeInTheDocument();
    }
  });

  it("requires a written reason before cancelling (no window.prompt)", async () => {
    renderOverview("CONFIRMED");

    await userEvent.click(screen.getByRole("button", { name: "إلغاء المناسبة" }));
    expect(screen.getByText("تأكيد إلغاء المناسبة")).toBeInTheDocument();

    // Confirming without a reason does nothing.
    await userEvent.click(screen.getByRole("button", { name: "تأكيد الإلغاء" }));
    expect(run).not.toHaveBeenCalled();

    await userEvent.type(
      screen.getByRole("textbox", { name: "سبب الإلغاء" }),
      "اعتذر العميل",
    );
    await userEvent.click(screen.getByRole("button", { name: "تأكيد الإلغاء" }));
    expect(run).toHaveBeenCalledWith(
      "cancel_event",
      expect.objectContaining({ p_reason: "اعتذر العميل" }),
    );
  });

  it("offers cancellation for mid-execution statuses too", () => {
    for (const status of ["DISPATCHED", "IN_PROGRESS"] as const) {
      renderOverview(status);
      expect(
        screen.getByRole("button", { name: "إلغاء المناسبة" }),
      ).toBeInTheDocument();
      cleanup();
    }
  });

  it("points a confirmed event to execute then collect profit", () => {
    renderOverview("CONFIRMED");
    expect(screen.getByText(/ابدأ التجهيز، ثم نفّذ المناسبة/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تسجيل دفعة" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "المصروف والربح" })).toBeInTheDocument();
  });

  it("hides cancellation from non-commercial roles", () => {
    renderOverview("PREPARING", { canCommercial: false, canFinance: false });
    expect(
      screen.queryByRole("button", { name: "إلغاء المناسبة" }),
    ).not.toBeInTheDocument();
    // The next operational step stays available for operational roles.
    expect(screen.getByRole("button", { name: "تأكيد الإرسال" })).toBeInTheDocument();
  });
});
