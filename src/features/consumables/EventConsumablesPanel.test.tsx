import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventConsumablesPanel } from "./EventConsumablesPanel";

// ---------------------------------------------------------------------------
// Mock the Supabase boundary only. The component, its queries, the model
// rules and the Arabic presentation are all exercised for real.
// ---------------------------------------------------------------------------
interface EventLineFixture {
  stock_item_id: string;
  item_name: string;
  issued_quantity: number | null;
  returned_quantity: number;
  consumed_quantity: number;
  wasted_quantity: number;
  outstanding_quantity: number | null;
  is_reconciled: boolean;
}

interface StockFixture {
  stock_item_id: string;
  item_name: string;
  on_hand_quantity: number;
  minimum_stock_quantity: number;
  is_low_stock: boolean;
  is_tracking_active: boolean;
}

const state: {
  eventLines: EventLineFixture[];
  stock: StockFixture[];
  summary: Record<string, unknown>;
  rpcError: string | null;
} = { eventLines: [], stock: [], summary: {}, rpcError: null };

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

function eventLine(overrides: Partial<EventLineFixture> = {}): EventLineFixture {
  return {
    stock_item_id: "stock-1",
    item_name: "قهوة عربية",
    issued_quantity: 8.25,
    returned_quantity: 0,
    consumed_quantity: 0,
    wasted_quantity: 0,
    outstanding_quantity: 8.25,
    is_reconciled: false,
    ...overrides,
  };
}

function fullEventRow(l: EventLineFixture) {
  return {
    organization_id: "org-1",
    event_id: "ev-1",
    catalog_item_id: "cat-1",
    item_unit: "كجم",
    reconciled_at: null,
    ...l,
  };
}

function stockLine(overrides: Partial<StockFixture> = {}): StockFixture {
  return {
    stock_item_id: "stock-1",
    item_name: "قهوة عربية",
    on_hand_quantity: 4.5,
    minimum_stock_quantity: 1,
    is_low_stock: false,
    is_tracking_active: true,
    ...overrides,
  };
}

function fullStockRow(l: StockFixture) {
  return {
    organization_id: "org-1",
    catalog_item_id: "cat-1",
    item_unit: "كجم",
    catalog_status: "ACTIVE",
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
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
          table === "event_consumable_lines"
            ? state.eventLines.map(fullEventRow)
            : table === "consumable_stock_summary"
              ? state.stock.map(fullStockRow)
              : [],
        ),
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        if (name === "event_consumable_summary") {
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
    status: "OUTSTANDING",
    issued: "8.250",
    returned: "0.000",
    consumed: "0.000",
    wasted: "0.000",
    outstanding: "8.250",
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

function renderPanel(
  props: Partial<Parameters<typeof EventConsumablesPanel>[0]> = {},
) {
  return render(
    <EventConsumablesPanel
      orgId="org-1"
      eventId="ev-1"
      eventStatus="PREPARING"
      role="WAREHOUSE"
      {...props}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  state.eventLines = [];
  state.stock = [];
  state.summary = summary();
  state.rpcError = null;
  rpcCalls.length = 0;
});

describe("EventConsumablesPanel", () => {
  it("renders the custody line with exact fractional quantities", async () => {
    state.eventLines = [
      eventLine({
        issued_quantity: 8.25,
        returned_quantity: 2,
        consumed_quantity: 5,
        wasted_quantity: 1,
        outstanding_quantity: 0.25,
      }),
    ];
    renderPanel();
    expect(await screen.findByText("قهوة عربية")).toBeInTheDocument();
    expect(screen.getAllByText("8.25").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.25").length).toBeGreaterThan(0);
    expect(screen.getAllByText("تم صرفه").length).toBeGreaterThan(0);
    expect(screen.getAllByText("مرتجع صالح").length).toBeGreaterThan(0);
    expect(screen.getAllByText("تم استهلاكه").length).toBeGreaterThan(0);
    expect(screen.getAllByText("هالك").length).toBeGreaterThan(0);
    expect(screen.getAllByText("المتبقي مع المناسبة").length).toBeGreaterThan(0);
  });

  it("issues an exact decimal quantity through the RPC", async () => {
    state.stock = [stockLine()];
    renderPanel();
    const user = userEvent.setup();
    await screen.findByText("صرف للمناسبة");
    await user.selectOptions(screen.getByRole("combobox"), "stock-1");
    await user.type(screen.getByPlaceholderText("0.000"), "2.5");
    await user.click(screen.getByRole("button", { name: "صرف" }));
    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "issue_consumable_to_event");
      expect(call).toBeDefined();
      expect(call?.args.p_quantity).toBe(2.5);
      expect(call?.args.p_stock_item_id).toBe("stock-1");
      expect(typeof call?.args.p_idempotency_key).toBe("string");
    });
  });

  it("blocks an issue larger than the available stock before any RPC", async () => {
    state.stock = [stockLine({ on_hand_quantity: 2 })];
    renderPanel();
    const user = userEvent.setup();
    await screen.findByText("صرف للمناسبة");
    await user.selectOptions(screen.getByRole("combobox"), "stock-1");
    await user.type(screen.getByPlaceholderText("0.000"), "5");
    await user.click(screen.getByRole("button", { name: "صرف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "الكمية أكبر من الرصيد المتوفر (2).",
    );
    expect(rpcCalls.some((c) => c.name === "issue_consumable_to_event")).toBe(false);
  });

  it("maps a server stock-shortage rejection to operator Arabic", async () => {
    state.stock = [stockLine()];
    state.rpcError = "CONSUMABLE_STOCK_SHORTAGE";
    renderPanel();
    const user = userEvent.setup();
    await screen.findByText("صرف للمناسبة");
    await user.selectOptions(screen.getByRole("combobox"), "stock-1");
    await user.type(screen.getByPlaceholderText("0.000"), "1");
    await user.click(screen.getByRole("button", { name: "صرف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "الكمية المطلوبة غير متوفرة في المخزن.",
    );
  });

  it("records a usable return through the return RPC", async () => {
    state.eventLines = [eventLine()];
    renderPanel();
    const user = userEvent.setup();
    await screen.findByText("قهوة عربية");
    await user.click(screen.getByRole("button", { name: "مرتجع صالح" }));
    await user.click(screen.getByRole("button", { name: "تأكيد" }));
    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "return_consumable_from_event");
      expect(call).toBeDefined();
      expect(call?.args.p_quantity).toBe(8.25);
    });
  });

  it("records consumption through the consume RPC", async () => {
    state.eventLines = [eventLine()];
    renderPanel();
    const user = userEvent.setup();
    await screen.findByText("قهوة عربية");
    await user.click(screen.getByRole("button", { name: "تم استهلاكه" }));
    await user.click(screen.getByRole("button", { name: "تأكيد" }));
    await waitFor(() => {
      expect(
        rpcCalls.some((c) => c.name === "consume_consumable_at_event"),
      ).toBe(true);
    });
  });

  it("requires a reason before recording Event waste", async () => {
    state.eventLines = [eventLine()];
    renderPanel();
    const user = userEvent.setup();
    await screen.findByText("قهوة عربية");
    await user.click(screen.getByRole("button", { name: "هالك" }));
    await user.click(screen.getByRole("button", { name: "تأكيد" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("سبب الهالك مطلوب.");
    expect(rpcCalls.some((c) => c.name === "waste_consumable_at_event")).toBe(false);

    await user.type(screen.getByPlaceholderText("اشرح سبب الهالك"), "انسكب");
    await user.click(screen.getByRole("button", { name: "تأكيد" }));
    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "waste_consumable_at_event");
      expect(call).toBeDefined();
      expect(call?.args.p_reason).toBe("انسكب");
    });
  });

  it("blocks over-accounting beyond the outstanding custody", async () => {
    state.eventLines = [eventLine({ outstanding_quantity: 1 })];
    renderPanel();
    const user = userEvent.setup();
    await screen.findByText("قهوة عربية");
    await user.click(screen.getByRole("button", { name: "تم استهلاكه" }));
    const quantityInput = screen.getByDisplayValue("1");
    await user.clear(quantityInput);
    await user.type(quantityInput, "3");
    await user.click(screen.getByRole("button", { name: "تأكيد" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "الكمية أكبر من المتبقي مع المناسبة (1).",
    );
    expect(rpcCalls.some((c) => c.name === "consume_consumable_at_event")).toBe(false);
  });

  it("keeps custody actions available for a cancelled Event with outstanding stock", async () => {
    state.eventLines = [eventLine()];
    renderPanel({ eventStatus: "CANCELLED" });
    await screen.findByText("قهوة عربية");
    // New issues are blocked with an explicit reason…
    expect(
      screen.getByText("لا يمكن الصرف في حالة المناسبة الحالية."),
    ).toBeInTheDocument();
    // …but returning/consuming/wasting the outstanding stock stays enabled.
    expect(screen.getByRole("button", { name: "مرتجع صالح" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "تم استهلاكه" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "هالك" })).toBeEnabled();
  });

  it("requires explicit confirmation before final reconciliation", async () => {
    state.eventLines = [
      eventLine({ consumed_quantity: 8.25, outstanding_quantity: 0 }),
    ];
    state.summary = summary({
      status: "READY_TO_RECONCILE",
      consumed: "8.250",
      outstanding: "0.000",
    });
    renderPanel({ role: "OWNER" });
    const user = userEvent.setup();
    await screen.findByText("التسوية النهائية للمواد الاستهلاكية");
    await user.click(
      screen.getByRole("button", { name: "إتمام التسوية النهائية" }),
    );
    expect(
      screen.getByText(
        "تأكيد نهائي: هل تريد إغلاق مواد هذه المناسبة؟ لا يمكن التراجع.",
      ),
    ).toBeInTheDocument();
    expect(rpcCalls.some((c) => c.name === "reconcile_event_consumables")).toBe(false);
    await user.click(screen.getByRole("button", { name: "نعم، إتمام التسوية" }));
    await waitFor(() => {
      expect(
        rpcCalls.some((c) => c.name === "reconcile_event_consumables"),
      ).toBe(true);
    });
  });

  it("blocks reconciliation while quantities remain outstanding", async () => {
    state.eventLines = [eventLine()];
    renderPanel({ role: "OWNER" });
    await screen.findByText("التسوية النهائية للمواد الاستهلاكية");
    expect(
      screen.getByRole("button", { name: "إتمام التسوية النهائية" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/لا يمكن التسوية وهناك كمية ما زالت مع المناسبة/),
    ).toBeInTheDocument();
  });

  it("hides reconciliation from WAREHOUSE entirely", async () => {
    state.eventLines = [eventLine()];
    renderPanel({ role: "WAREHOUSE" });
    await screen.findByText("قهوة عربية");
    expect(
      screen.queryByText("التسوية النهائية للمواد الاستهلاكية"),
    ).not.toBeInTheDocument();
  });

  it("renders the reconciled read-only state", async () => {
    state.eventLines = [
      eventLine({
        consumed_quantity: 8.25,
        outstanding_quantity: 0,
        is_reconciled: true,
      }),
    ];
    state.summary = summary({
      status: "RECONCILED",
      consumed: "8.250",
      outstanding: "0.000",
      is_reconciled: true,
    });
    renderPanel({ role: "OWNER" });
    expect((await screen.findAllByText("تمت التسوية")).length).toBeGreaterThan(0);
    // The issue form disappears after closure.
    expect(screen.queryByText("صرف للمناسبة")).not.toBeInTheDocument();
    // Custody buttons are disabled with the reconciled reason; read-only state.
    expect(screen.getByRole("button", { name: "مرتجع صالح" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "هالك" })).toBeDisabled();
    expect(
      screen.getByText("تمت تسوية مواد هذه المناسبة ولا يمكن التعديل."),
    ).toBeInTheDocument();
    // Re-reconciliation is blocked with its reason.
    expect(
      screen.getByRole("button", { name: "إتمام التسوية النهائية" }),
    ).toBeDisabled();
    expect(screen.getByText("تمت التسوية النهائية مسبقاً.")).toBeInTheDocument();
  });

  it("surfaces defective rows instead of rendering fake zeros", async () => {
    state.eventLines = [eventLine({ outstanding_quantity: null })];
    renderPanel();
    expect(
      await screen.findByText(/بيانات غير مكتملة في 1 سطر/),
    ).toBeInTheDocument();
    expect(screen.queryByText("قهوة عربية")).not.toBeInTheDocument();
  });

  it("never renders raw UUIDs or SQL error text", async () => {
    state.eventLines = [eventLine()];
    state.stock = [stockLine()];
    state.rpcError =
      'insert into "consumable_movements" violates constraint id=3f7c9a10-1111-2222-3333-444444444444';
    const { container } = renderPanel();
    const user = userEvent.setup();
    await screen.findByText("صرف للمناسبة");
    await user.selectOptions(screen.getByRole("combobox"), "stock-1");
    await user.type(screen.getByPlaceholderText("0.000"), "1");
    await user.click(screen.getByRole("button", { name: "صرف" }));
    await screen.findAllByRole("alert");
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(container.textContent).not.toContain("constraint");
    expect(container.textContent).not.toContain("stock-1");
  });
});
