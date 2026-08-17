import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditEventDialog } from "./EditEventDialog";
import type { EventRow } from "../events.api";

const mutateAsync = vi.fn();

vi.mock("../events.api", () => ({
  useUpdateEvent: () => ({ mutateAsync, isPending: false }),
  arabicError: (cause: unknown) =>
    cause instanceof Error ? cause.message : String(cause),
}));

function event(): EventRow {
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
    status: "DRAFT",
    cancellation_reason: null,
    accepted_quotation_id: null,
    created_at: "2026-08-10T00:00:00Z",
  };
}

describe("EditEventDialog (F12)", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    mutateAsync.mockResolvedValue(undefined);
  });

  it("prefills the current logistics and submits the update payload", async () => {
    render(
      <EditEventDialog
        open
        onOpenChange={() => {}}
        orgId="org-1"
        event={event()}
      />,
    );

    const title = screen.getByLabelText(/عنوان المناسبة/);
    expect(title).toHaveValue("مناسبة قاعة الريان");

    await userEvent.clear(title);
    await userEvent.type(title, "مناسبة معدلة");
    await userEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "ev-1",
      title: "مناسبة معدلة",
      eventType: "زفاف",
      startAt: expect.any(String),
      endAt: expect.any(String),
      guestCount: 120,
      venue: "قاعة الريان",
      contactName: "",
      contactPhone: "",
      notes: "",
    });
  });

  it("maps a rejected edit to the domain error message", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("row-level security policy"));

    render(
      <EditEventDialog
        open
        onOpenChange={() => {}}
        orgId="org-1"
        event={event()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));
    expect(
      await screen.findByText("row-level security policy"),
    ).toBeInTheDocument();
  });
});
