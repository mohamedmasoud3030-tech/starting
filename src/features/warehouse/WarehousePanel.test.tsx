import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WarehousePanel } from "./WarehousePanel";

// ---------------------------------------------------------------------------
// Mock the Supabase boundary only. The component, its queries, the model
// rules and the Arabic presentation are all exercised for real.
// ---------------------------------------------------------------------------
interface LineFixture {
  reservation_id: string;
  equipment_name: string;
  reserved_quantity: number | null;
  dispatched_quantity: number;
  returned_good_quantity: number;
  damaged_quantity: number;
  lost_quantity: number;
  outstanding_quantity: number | null;
  reservation_status: string;
  is_reconciled: boolean;
}

const state: {
  lines: LineFixture[];
  summary: Record<string, unknown>;
  valued: Array<Record<string, unknown>>;
  rpcError: string | null;
} = { lines: [], summary: {}, valued: [], rpcError: null };

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

function line(overrides: Partial<LineFixture> = {}): LineFixture {
  return {
    reservation_id: "res-1",
    equipment_name: "كراسي",
    reserved_quantity: 10,
    dispatched_quantity: 0,
    returned_good_quantity: 0,
    damaged_quantity: 0,
    lost_quantity: 0,
    outstanding_quantity: 0,
    reservation_status: "ACTIVE",
    is_reconciled: false,
    ...overrides,
  };
}

function fullRow(l: LineFixture) {
  return {
    capacity_total_quantity: 100,
    catalog_item_id: "cat-1",
    equipment_capacity_id: "cap-1",
    equipment_unit: "قطعة",
    event_id: "ev-1",
    organization_id: "org-1",
    reconciled_at: null,
    reserved_from: "2026-10-01T06:00:00Z",
    reserved_until: "2026-10-01T16:00:00Z",
    ...l,
  };
}

vi.mock("@/lib/supabase", () => {
  const chain = (rows: unknown[]) => {
    const c = {
      select: () => c,
      eq: () => c,
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        resolve({ data: rows, error: null }),
    };
    return c;
  };
  return {
    supabase: {
      from: (table: string) =>
        chain(
          table === "event_warehouse_lines"
            ? state.lines.map(fullRow)
            : table === "event_warehouse_lines_valued"
              ? state.valued
              : [],
        ),
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        if (name === "event_warehouse_summary") {
          return { data: state.summary, error: null };
        }
        if (state.rpcError) {
          return { data: null, error: new Error(state.rpcError) };
        }
        return { data: { id: "mv-1" }, error: null };
      },
    },
  };
});

function summary(overrides: Record<string, unknown> = {}) {
  return {
    status: "AWAITING_DISPATCH",
    reserved: 10,
    dispatched: 0,
    returned_good: 0,
    damaged: 0,
    lost: 0,
    outstanding: 0,
    is_reconciled: false,
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderPanel(props: Partial<Parameters<typeof WarehousePanel>[0]> = {}) {
  return render(
    <WarehousePanel
      orgId="org-1"
      eventId="ev-1"
      eventStatus="PREPARING"
      role="WAREHOUSE"
      capabilities={null}
      canReadCost={false}
      {...props}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  rpcCalls.length = 0;
  state.lines = [line()];
  state.summary = summary();
  state.valued = [];
  state.rpcError = null;
});

describe("operator overview", () => {
  it("shows every warehouse quantity the operator needs, in Arabic", async () => {
    state.lines = [
      line({
        dispatched_quantity: 8,
        returned_good_quantity: 3,
        damaged_quantity: 2,
        lost_quantity: 1,
        outstanding_quantity: 2,
      }),
    ];
    state.summary = summary({
      status: "OUTSTANDING",
      dispatched: 8,
      returned_good: 3,
      damaged: 2,
      lost: 1,
      outstanding: 2,
    });
    renderPanel();

    await screen.findByText("كراسي");
    for (const label of [
      "المطلوب تجهيزه",
      "المحجوز",
      "تم صرفه",
      "تم إرجاعه",
      "تالف",
      "مفقود",
      "متبقي بالخارج",
      "حالة التسوية",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("معدات بالخارج")).toBeInTheDocument();
  });

  it("never renders a raw UUID", async () => {
    renderPanel();
    await screen.findByText("كراسي");
    expect(document.body.textContent).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(document.body.textContent).not.toContain("res-1");
  });

  it("tells the operator when no equipment is reserved", async () => {
    state.lines = [];
    state.summary = summary({ status: "NO_EQUIPMENT", reserved: 0 });
    renderPanel();
    expect(
      await screen.findByText(/لا توجد معدات محجوزة لهذه المناسبة/),
    ).toBeInTheDocument();
  });

  it("surfaces incomplete data instead of showing a confident wrong zero", async () => {
    state.lines = [line({ outstanding_quantity: null })];
    renderPanel();
    expect(await screen.findByText(/بيانات غير مكتملة/)).toBeInTheDocument();
    expect(screen.queryByText("كراسي")).not.toBeInTheDocument();
  });
});

describe("dispatch flow", () => {
  it("dispatches the remaining quantity with an idempotency key", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "صرف من المخزن" }));
    await user.click(screen.getByRole("button", { name: "تأكيد الصرف" }));

    await waitFor(() => {
      expect(rpcCalls.some((c) => c.name === "dispatch_event_equipment")).toBe(true);
    });
    const call = rpcCalls.find((c) => c.name === "dispatch_event_equipment")!;
    expect(call.args.p_quantity).toBe(10);
    expect(call.args.p_reservation_id).toBe("res-1");
    expect(typeof call.args.p_idempotency_key).toBe("string");
  });

  it("lets the operator adjust the quantity without typing", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "صرف من المخزن" }));
    await user.click(screen.getByRole("button", { name: "إنقاص الكمية المصروفة" }));
    await user.click(screen.getByRole("button", { name: "تأكيد الصرف" }));

    await waitFor(() => {
      expect(rpcCalls.some((c) => c.name === "dispatch_event_equipment")).toBe(true);
    });
    expect(
      rpcCalls.find((c) => c.name === "dispatch_event_equipment")!.args.p_quantity,
    ).toBe(9);
  });

  it("blocks dispatch on a DRAFT Event and explains why", async () => {
    renderPanel({ eventStatus: "DRAFT" });
    const button = await screen.findByRole("button", { name: "صرف من المخزن" });
    expect(button).toBeDisabled();
    expect(screen.getByText("لا يمكن الصرف قبل تأكيد المناسبة.")).toBeInTheDocument();
  });

  it("blocks dispatch for a role that does not own it", async () => {
    renderPanel({ role: "ACCOUNTANT" });
    expect(await screen.findByRole("button", { name: "صرف من المخزن" })).toBeDisabled();
    expect(screen.getByText("لا تملك صلاحية صرف المعدات.")).toBeInTheDocument();
  });

  it("blocks dispatch once the whole reservation is already out", async () => {
    state.lines = [
      line({ dispatched_quantity: 10, outstanding_quantity: 10 }),
    ];
    renderPanel();
    expect(await screen.findByRole("button", { name: "صرف من المخزن" })).toBeDisabled();
    expect(screen.getByText("تم صرف كامل الكمية المحجوزة.")).toBeInTheDocument();
  });

  it("shows a readable Arabic message when the server rejects the dispatch", async () => {
    const user = userEvent.setup();
    state.rpcError = "DISPATCH_EXCEEDS_RESERVATION";
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "صرف من المخزن" }));
    await user.click(screen.getByRole("button", { name: "تأكيد الصرف" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("الكمية المطلوبة أكبر من المتبقي في الحجز.");
    expect(alert.textContent).not.toContain("DISPATCH_EXCEEDS_RESERVATION");
  });
});

describe("return flow", () => {
  beforeEach(() => {
    state.lines = [line({ dispatched_quantity: 10, outstanding_quantity: 6 })];
    state.summary = summary({ status: "OUTSTANDING", dispatched: 10, outstanding: 6 });
  });

  it("records a mixed returned / damaged / lost return", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "تسجيل إرجاع" }));
    // Default is "all good"; move two units into damaged and lost.
    await user.click(screen.getByRole("button", { name: "إنقاص سليم" }));
    await user.click(screen.getByRole("button", { name: "إنقاص سليم" }));
    await user.click(screen.getByRole("button", { name: "زيادة تالف" }));
    await user.click(screen.getByRole("button", { name: "زيادة مفقود" }));
    await user.click(screen.getByRole("button", { name: "تأكيد الإرجاع" }));

    await waitFor(() => {
      expect(rpcCalls.some((c) => c.name === "return_event_equipment")).toBe(true);
    });
    const call = rpcCalls.find((c) => c.name === "return_event_equipment")!;
    expect(call.args.p_returned_good_quantity).toBe(4);
    expect(call.args.p_damaged_quantity).toBe(1);
    expect(call.args.p_lost_quantity).toBe(1);
  });

  it("blocks a return when nothing is outstanding", async () => {
    state.lines = [line({ dispatched_quantity: 10, returned_good_quantity: 10 })];
    renderPanel();
    expect(await screen.findByRole("button", { name: "تسجيل إرجاع" })).toBeDisabled();
    expect(screen.getByText("لا توجد كمية بالخارج لإرجاعها.")).toBeInTheDocument();
  });

  it("refuses locally to return more than is outstanding", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "تسجيل إرجاع" }));
    // Outstanding is 6 and "سليم" already defaults to 6; adding damage overflows.
    await user.click(screen.getByRole("button", { name: "زيادة تالف" }));
    await user.click(screen.getByRole("button", { name: "تأكيد الإرجاع" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "المجموع (7) أكبر من المتبقي بالخارج (6).",
    );
    expect(rpcCalls.some((c) => c.name === "return_event_equipment")).toBe(false);
  });
});

describe("reconciliation", () => {
  it("hides the final reconciliation from a warehouse operator", async () => {
    renderPanel({ role: "WAREHOUSE" });
    await screen.findByText("كراسي");
    expect(screen.queryByText("التسوية النهائية للمخزن")).not.toBeInTheDocument();
  });

  it("blocks reconciliation while stock is outstanding, and says how much", async () => {
    state.lines = [line({ dispatched_quantity: 10, outstanding_quantity: 4 })];
    state.summary = summary({ status: "OUTSTANDING", dispatched: 10, outstanding: 4 });
    renderPanel({ role: "OWNER" });

    const button = await screen.findByRole("button", { name: "إتمام التسوية النهائية" });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/لا يمكن التسوية وهناك كمية ما زالت بالخارج. المتبقي بالخارج: 4./),
    ).toBeInTheDocument();
  });

  it("requires an explicit confirmation before finalizing", async () => {
    const user = userEvent.setup();
    state.lines = [line({ dispatched_quantity: 10, returned_good_quantity: 10 })];
    state.summary = summary({
      status: "READY_TO_RECONCILE",
      dispatched: 10,
      returned_good: 10,
      outstanding: 0,
    });
    renderPanel({ role: "OWNER" });

    await user.click(
      await screen.findByRole("button", { name: "إتمام التسوية النهائية" }),
    );
    // Nothing is sent until the operator confirms the irreversible action.
    expect(rpcCalls.some((c) => c.name === "reconcile_event_warehouse")).toBe(false);
    expect(screen.getByText(/لا يمكن التراجع/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "نعم، إتمام التسوية" }));
    await waitFor(() => {
      expect(rpcCalls.some((c) => c.name === "reconcile_event_warehouse")).toBe(true);
    });
  });

  it("lets the operator back out of the confirmation", async () => {
    const user = userEvent.setup();
    state.lines = [line({ dispatched_quantity: 10, returned_good_quantity: 10 })];
    state.summary = summary({
      status: "READY_TO_RECONCILE",
      dispatched: 10,
      returned_good: 10,
    });
    renderPanel({ role: "OWNER" });

    await user.click(
      await screen.findByRole("button", { name: "إتمام التسوية النهائية" }),
    );
    await user.click(screen.getByRole("button", { name: "تراجع" }));
    expect(screen.queryByText(/لا يمكن التراجع/)).not.toBeInTheDocument();
    expect(rpcCalls.some((c) => c.name === "reconcile_event_warehouse")).toBe(false);
  });

  it("freezes both physical actions once the warehouse is reconciled", async () => {
    state.lines = [
      line({
        dispatched_quantity: 10,
        returned_good_quantity: 10,
        is_reconciled: true,
      }),
    ];
    state.summary = summary({
      status: "RECONCILED",
      dispatched: 10,
      returned_good: 10,
      is_reconciled: true,
    });
    renderPanel({ role: "OWNER" });

    await screen.findByText("كراسي");
    expect(screen.getByRole("button", { name: "صرف من المخزن" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "تسجيل إرجاع" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "إتمام التسوية النهائية" }),
    ).toBeDisabled();
    expect(screen.getAllByText("تمت التسوية").length).toBeGreaterThan(0);
  });
});

describe("commercial separation", () => {
  it("shows the damage/loss valuation to a cost reader", async () => {
    state.lines = [
      line({ dispatched_quantity: 10, damaged_quantity: 2, returned_good_quantity: 8 }),
    ];
    state.valued = [
      {
        reservation_id: "res-1",
        organization_id: "org-1",
        event_id: "ev-1",
        equipment_capacity_id: "cap-1",
        reserved_quantity: 10,
        dispatched_quantity: 10,
        returned_good_quantity: 8,
        damaged_quantity: 2,
        lost_quantity: 0,
        outstanding_quantity: 0,
        damage_loss_valuation_omr: 8.5,
        unit_valuation_omr: 4.25,
        valuation_basis: "CATALOG_COST_SNAPSHOT",
      },
    ];
    renderPanel({ role: "OWNER", canReadCost: true });

    expect(await screen.findByText(/قيمة التالف والمفقود/)).toHaveTextContent(
      "8.500",
    );
  });

  it("shows no valuation at all to a warehouse operator", async () => {
    state.lines = [
      line({ dispatched_quantity: 10, damaged_quantity: 2, returned_good_quantity: 8 }),
    ];
    renderPanel({ role: "WAREHOUSE", canReadCost: false });

    await screen.findByText("كراسي");
    expect(screen.queryByText(/قيمة التالف والمفقود/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("ر.ع.");
  });

  it("still shows the damage COUNT to a warehouse operator (quantity, not cost)", async () => {
    state.lines = [
      line({ dispatched_quantity: 10, damaged_quantity: 2, returned_good_quantity: 8 }),
    ];
    state.summary = summary({ dispatched: 10, returned_good: 8, damaged: 2 });
    renderPanel({ role: "WAREHOUSE", canReadCost: false });

    await screen.findByText("كراسي");
    const damageLabel = screen.getAllByText("تالف")[0];
    const chip = damageLabel?.parentElement;
    expect(chip).not.toBeNull();
    expect(within(chip as HTMLElement).getByText("2")).toBeInTheDocument();
  });
});
