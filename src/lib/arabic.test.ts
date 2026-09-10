import { describe, expect, it } from "vitest";
import {
  EVENT_STATUS_ARABIC,
  EVENT_STATUS_TONES,
  INVOICE_STATUS_ARABIC,
  INSTALLMENT_STATUS_ARABIC,
  QUOTATION_STATUS_ARABIC,
  QUOTATION_STATUS_TONES,
} from "./arabic";
import { EVENT_STATUS_LABELS } from "@/features/events/eventWorkspace.model";

const EVENT_STATUSES = [
  "DRAFT",
  "QUOTED",
  "CONFIRMED",
  "PREPARING",
  "DISPATCHED",
  "IN_PROGRESS",
  "RETURNING",
  "CLOSED",
  "CANCELLED",
] as const;

const QUOTATION_STATUSES = [
  "DRAFT",
  "ISSUED",
  "EXPIRED",
  "ACCEPTED",
  "REJECTED",
  "CONVERTED",
  "CANCELLED",
  "SUPERSEDED",
] as const;

const INVOICE_STATUSES = ["ISSUED", "CANCELLED"] as const;

const INSTALLMENT_STATUSES = ["PENDING", "PAID", "CANCELLED"] as const;

const TONES = ["neutral", "brand", "success", "warning", "danger"] as const;

/** Every canonical status map must localize every code and never echo it back. */
function expectLocalized(statuses: readonly string[], map: Record<string, string>) {
  for (const status of statuses) {
    const label = map[status];
    expect(label, `${status} label`).toBeTruthy();
    expect(label, `${status} is localized`).not.toBe(status);
  }
}

describe("canonical event-status presentation (Arabic-first)", () => {
  it("gives every lifecycle status a non-empty Arabic label", () => {
    expectLocalized(EVENT_STATUSES, EVENT_STATUS_ARABIC);
  });

  it("maps every lifecycle status to a valid Badge tone", () => {
    for (const status of EVENT_STATUSES) {
      expect(TONES).toContain(EVENT_STATUS_TONES[status]);
    }
  });

  it("re-exports the workspace label map from the same single source", () => {
    // The workspace/calendar/header consumers must not keep a parallel copy.
    expect(EVENT_STATUS_LABELS).toBe(EVENT_STATUS_ARABIC);
  });
});

describe("canonical quotation-status presentation (Arabic-first)", () => {
  it("gives every quotation status a non-empty, non-raw Arabic label", () => {
    expectLocalized(QUOTATION_STATUSES, QUOTATION_STATUS_ARABIC);
  });

  it("maps every quotation status to a valid Badge tone", () => {
    for (const status of QUOTATION_STATUSES) {
      expect(TONES).toContain(QUOTATION_STATUS_TONES[status]);
    }
  });
});


describe("canonical invoice-status presentation (Arabic-first)", () => {
  it("localizes every invoice status distinctly (cancelled never reads as issued)", () => {
    expectLocalized(INVOICE_STATUSES, INVOICE_STATUS_ARABIC);
    expect(INVOICE_STATUS_ARABIC["ISSUED"]).not.toBe(INVOICE_STATUS_ARABIC["CANCELLED"]);
  });
});

describe("canonical installment-status presentation (Arabic-first)", () => {
  it("localizes every installment status distinctly (cancelled never reads as due)", () => {
    expectLocalized(INSTALLMENT_STATUSES, INSTALLMENT_STATUS_ARABIC);
    expect(INSTALLMENT_STATUS_ARABIC["PENDING"]).toBe("مستحق");
    expect(INSTALLMENT_STATUS_ARABIC["CANCELLED"]).toBe("ملغى");
  });
});
