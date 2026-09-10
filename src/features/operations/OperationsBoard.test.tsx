import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OperationsBoard } from "./OperationsBoard";

/**
 * Daily operations board (جدول التشغيل).
 *
 * Pins the real bucketing rules the owner relies on every morning:
 * today / tomorrow / not-ready / awaiting-dispatch / awaiting-return, the
 * exclusion of CLOSED + CANCELLED events, and that a shortfall is stated as
 * plain Arabic numbers rather than a fabricated score.
 */

type Row = {
  id: string;
  title: string;
  start_at: string;
  venue_name: string;
  status: string;
};

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  readiness: [] as Array<{
    event_id: string;
    status: string;
    staff_missing: number;
    equipment_shortage: number;
  }>,
}));

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({ currentOrganization: { id: "org-1", name: "دار الضيافة" } }),
}));

vi.mock("@/features/events/events.api", () => ({
  useEvents: () => ({ data: { rows: state.rows }, isLoading: false }),
}));

vi.mock("@/lib/rpc", () => ({
  callRpc: async () => state.readiness,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperationsBoard />
    </QueryClientProvider>,
  );
}

/** A Muscat-safe ISO timestamp at local noon, offset by N days. */
function noonIso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function section(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: title, level: 2 });
  const card = heading.closest("div");
  if (!card) throw new Error(`no card for ${title}`);
  return card as HTMLElement;
}

beforeEach(() => {
  state.rows = [];
  state.readiness = [];
});

describe("OperationsBoard — daily bucketing", () => {
  it("renders the page heading and all five operational buckets", () => {
    renderBoard();

    expect(screen.getByRole("heading", { name: "جدول التشغيل" })).toBeInTheDocument();
    for (const title of [
      "مناسبات اليوم",
      "مناسبات الغد",
      "غير جاهزة",
      "بانتظار الإرسال",
      "بانتظار الإرجاع",
    ]) {
      expect(screen.getByRole("heading", { name: title, level: 2 })).toBeInTheDocument();
    }
  });

  it("states the empty reason in each bucket when there is nothing to do", () => {
    renderBoard();

    expect(screen.getByText("لا توجد مناسبات اليوم.")).toBeInTheDocument();
    expect(screen.getByText("لا توجد مناسبات غداً.")).toBeInTheDocument();
    expect(screen.getByText("كل المناسبات النشطة جاهزة أو بلا متطلبات.")).toBeInTheDocument();
    expect(screen.getByText("لا توجد مناسبات بانتظار الإرسال.")).toBeInTheDocument();
    expect(screen.getByText("لا توجد معدات بانتظار الإرجاع.")).toBeInTheDocument();
  });

  it("puts an event starting today under مناسبات اليوم only", () => {
    state.rows = [
      { id: "e-today", title: "حفل زفاف", start_at: noonIso(0), venue_name: "قاعة السلام", status: "CONFIRMED" },
    ];
    renderBoard();

    expect(within(section("مناسبات اليوم")).getByText("حفل زفاف")).toBeInTheDocument();
    expect(within(section("مناسبات الغد")).queryByText("حفل زفاف")).not.toBeInTheDocument();
  });

  it("puts an event starting tomorrow under مناسبات الغد only", () => {
    state.rows = [
      { id: "e-tomorrow", title: "مؤتمر الشركات", start_at: noonIso(1), venue_name: "فندق الخليج", status: "CONFIRMED" },
    ];
    renderBoard();

    expect(within(section("مناسبات الغد")).getByText("مؤتمر الشركات")).toBeInTheDocument();
    expect(within(section("مناسبات اليوم")).queryByText("مؤتمر الشركات")).not.toBeInTheDocument();
  });

  it("shows the readiness shortfall as explicit Arabic counts", async () => {
    state.rows = [
      { id: "e-1", title: "عقيقة", start_at: noonIso(0), venue_name: "القاعة الصغرى", status: "CONFIRMED" },
    ];
    state.readiness = [
      { event_id: "e-1", status: "NOT_READY", staff_missing: 2, equipment_shortage: 3 },
    ];
    renderBoard();

    const today = section("مناسبات اليوم");
    expect(await within(today).findByText("غير جاهزة")).toBeInTheDocument();
    expect(within(today).getByText(/ناقص: فريق 2 · معدات 3/)).toBeInTheDocument();
  });

  it("marks a fully ready event as جاهزة and lists it under غير جاهزة NOWHERE", async () => {
    state.rows = [
      { id: "e-ready", title: "غداء عمل", start_at: noonIso(0), venue_name: "المقر", status: "CONFIRMED" },
    ];
    state.readiness = [{ event_id: "e-ready", status: "READY", staff_missing: 0, equipment_shortage: 0 }];
    renderBoard();

    expect(await within(section("مناسبات اليوم")).findByText("جاهزة")).toBeInTheDocument();
    expect(within(section("غير جاهزة")).queryByText("غداء عمل")).not.toBeInTheDocument();
  });

  it("surfaces a not-ready event even when it is neither today nor tomorrow", async () => {
    state.rows = [
      { id: "e-far", title: "حفل بعيد", start_at: noonIso(9), venue_name: "قاعة الشمال", status: "CONFIRMED" },
    ];
    state.readiness = [{ event_id: "e-far", status: "NOT_READY", staff_missing: 1, equipment_shortage: 0 }];
    renderBoard();

    expect(await within(section("غير جاهزة")).findByText("حفل بعيد")).toBeInTheDocument();
  });

  it("puts PREPARING events under بانتظار الإرسال", () => {
    state.rows = [
      { id: "e-prep", title: "مناسبة قيد التحضير", start_at: noonIso(0), venue_name: "المستودع", status: "PREPARING" },
    ];
    renderBoard();

    expect(within(section("بانتظار الإرسال")).getByText("مناسبة قيد التحضير")).toBeInTheDocument();
  });

  it("puts DISPATCHED / IN_PROGRESS / RETURNING events under بانتظار الإرجاع", () => {
    state.rows = [
      { id: "e-d", title: "مُرسلة", start_at: noonIso(0), venue_name: "أ", status: "DISPATCHED" },
      { id: "e-p", title: "جارية", start_at: noonIso(0), venue_name: "ب", status: "IN_PROGRESS" },
      { id: "e-r", title: "عائدة", start_at: noonIso(0), venue_name: "ج", status: "RETURNING" },
    ];
    renderBoard();

    const toReturn = section("بانتظار الإرجاع");
    expect(within(toReturn).getByText("مُرسلة")).toBeInTheDocument();
    expect(within(toReturn).getByText("جارية")).toBeInTheDocument();
    expect(within(toReturn).getByText("عائدة")).toBeInTheDocument();
  });

  it("never lists CLOSED or CANCELLED events in any bucket", () => {
    state.rows = [
      { id: "e-closed", title: "منتهية", start_at: noonIso(0), venue_name: "أ", status: "CLOSED" },
      { id: "e-cancel", title: "ملغاة", start_at: noonIso(0), venue_name: "ب", status: "CANCELLED" },
    ];
    state.readiness = [
      { event_id: "e-closed", status: "NOT_READY", staff_missing: 1, equipment_shortage: 1 },
      { event_id: "e-cancel", status: "NOT_READY", staff_missing: 1, equipment_shortage: 1 },
    ];
    renderBoard();

    expect(screen.queryByText("منتهية")).not.toBeInTheDocument();
    expect(screen.queryByText("ملغاة")).not.toBeInTheDocument();
    for (const title of ["مناسبات اليوم", "غير جاهزة", "بانتظار الإرسال", "بانتظار الإرجاع"]) {
      expect(within(section(title)).queryByText("منتهية")).not.toBeInTheDocument();
    }
  });

  it("links each event straight to its workspace", () => {
    state.rows = [
      { id: "e-link", title: "حفل", start_at: noonIso(0), venue_name: "قاعة", status: "CONFIRMED" },
    ];
    renderBoard();

    const link = within(section("مناسبات اليوم")).getByRole("link");
    expect(link).toHaveAttribute("href", "/events/$eventId");
  });

  it("shows a dash rather than a fabricated readiness state when none is returned", async () => {
    state.rows = [
      { id: "e-none", title: "بدون جاهزية", start_at: noonIso(0), venue_name: "قاعة", status: "CONFIRMED" },
    ];
    state.readiness = [];
    renderBoard();

    const today = section("مناسبات اليوم");
    expect(await within(today).findByText("بدون جاهزية")).toBeInTheDocument();
    expect(within(today).getByText("—")).toBeInTheDocument();
  });
});
