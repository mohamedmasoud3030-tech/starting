import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppRole } from "@/lib/dbTypes";
import { ConsumablesPage } from "./ConsumablesPage";

// ---------------------------------------------------------------------------
// Mock the auth + Supabase boundaries only; everything else runs for real.
// ---------------------------------------------------------------------------
const authState: { role: AppRole } = { role: "WAREHOUSE" };

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    currentOrganization: { id: "org-1", name: "Org" },
    currentRole: authState.role,
  }),
}));

interface StockFixture {
  stock_item_id: string;
  item_name: string;
  item_unit: string;
  on_hand_quantity: number | null;
  minimum_stock_quantity: number | null;
  is_low_stock: boolean | null;
  is_tracking_active: boolean;
}

const state: {
  stock: StockFixture[];
  untrackedCatalog: Array<Record<string, unknown>>;
  rpcError: string | null;
} = { stock: [], untrackedCatalog: [], rpcError: null };

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

function stockRow(overrides: Partial<StockFixture> = {}): StockFixture {
  return {
    stock_item_id: "stock-1",
    item_name: "قهوة عربية",
    item_unit: "كجم",
    on_hand_quantity: 12.5,
    minimum_stock_quantity: 5,
    is_low_stock: false,
    is_tracking_active: true,
    ...overrides,
  };
}

function fullRow(l: StockFixture) {
  return {
    organization_id: "org-1",
    catalog_item_id: "cat-1",
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
          table === "consumable_stock_summary"
            ? state.stock.map(fullRow)
            : table === "catalog_items_operational"
              ? state.untrackedCatalog
              : table === "consumable_stock_items"
                ? state.stock.map(() => ({ catalog_item_id: "cat-1" }))
                : [],
        ),
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        if (state.rpcError) {
          return { data: null, error: new Error(state.rpcError) };
        }
        return { data: { id: "row-1" }, error: null };
      },
    },
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  authState.role = "WAREHOUSE";
  state.stock = [];
  state.untrackedCatalog = [];
  state.rpcError = null;
  rpcCalls.length = 0;
});

describe("ConsumablesPage", () => {
  it("lists tracked items with exact quantities, unit, and thresholds", async () => {
    state.stock = [
      stockRow(),
      stockRow({
        stock_item_id: "stock-2",
        item_name: "تمر خلاص",
        on_hand_quantity: 0.375,
        minimum_stock_quantity: 2,
        is_low_stock: true,
      }),
    ];
    render(<ConsumablesPage />, { wrapper });
    expect(await screen.findByText("قهوة عربية")).toBeInTheDocument();
    expect(screen.getByText("تمر خلاص")).toBeInTheDocument();
    expect(screen.getByText("12.5")).toBeInTheDocument();
    expect(screen.getByText("0.375")).toBeInTheDocument();
    expect(screen.getAllByText("الوحدة: كجم").length).toBe(2);
  });

  it("flags low-stock items and counts them in the banner", async () => {
    state.stock = [
      stockRow({ is_low_stock: true, on_hand_quantity: 1 }),
      stockRow({ stock_item_id: "stock-2", item_name: "تمر", is_low_stock: false }),
    ];
    render(<ConsumablesPage />, { wrapper });
    expect(await screen.findByText("صنف واحد منخفض المخزون.")).toBeInTheDocument();
    expect(screen.getByText("منخفض المخزون")).toBeInTheDocument();
  });

  it("shows the empty state when nothing is tracked", async () => {
    render(<ConsumablesPage />, { wrapper });
    expect(await screen.findByText("لا توجد أصناف متتبعة")).toBeInTheDocument();
  });

  it("receives stock with an exact decimal quantity", async () => {
    state.stock = [stockRow()];
    render(<ConsumablesPage />, { wrapper });
    const user = userEvent.setup();
    await screen.findByText("قهوة عربية");
    await user.click(screen.getByRole("button", { name: "استلام" }));
    await user.type(screen.getByPlaceholderText("0.000"), "3.25");
    await user.click(screen.getByRole("button", { name: "تأكيد الاستلام" }));
    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "receive_consumable_stock");
      expect(call).toBeDefined();
      expect(call?.args.p_quantity).toBe(3.25);
      expect(typeof call?.args.p_idempotency_key).toBe("string");
    });
  });

  it("rejects over-precision input before any RPC", async () => {
    state.stock = [stockRow()];
    render(<ConsumablesPage />, { wrapper });
    const user = userEvent.setup();
    await screen.findByText("قهوة عربية");
    await user.click(screen.getByRole("button", { name: "استلام" }));
    await user.type(screen.getByPlaceholderText("0.000"), "1.0001");
    await user.click(screen.getByRole("button", { name: "تأكيد الاستلام" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "أدخل كمية صحيحة بثلاث خانات عشرية كحد أقصى.",
    );
    expect(rpcCalls.length).toBe(0);
  });

  it("requires a reason and a confirmation for warehouse waste", async () => {
    state.stock = [stockRow()];
    render(<ConsumablesPage />, { wrapper });
    const user = userEvent.setup();
    await screen.findByText("قهوة عربية");
    await user.click(screen.getByRole("button", { name: "إتلاف" }));
    await user.type(screen.getByPlaceholderText("0.000"), "2");
    await user.click(screen.getByRole("button", { name: "تسجيل الإتلاف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("سبب الإتلاف مطلوب.");
    expect(rpcCalls.length).toBe(0);

    await user.type(screen.getByPlaceholderText("اشرح السبب"), "تلف بالرطوبة");
    await user.click(screen.getByRole("button", { name: "تسجيل الإتلاف" }));
    // First valid submit arms the confirmation step; nothing sent yet.
    expect(
      screen.getByText("تأكيد نهائي: هذه العملية تغيّر الرصيد الفعلي ولا يمكن حذفها."),
    ).toBeInTheDocument();
    expect(rpcCalls.length).toBe(0);
    await user.click(screen.getByRole("button", { name: "نعم، تنفيذ" }));
    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "waste_consumable_stock");
      expect(call).toBeDefined();
      expect(call?.args.p_reason).toBe("تلف بالرطوبة");
    });
  });

  it("blocks wasting more than the current balance", async () => {
    state.stock = [stockRow({ on_hand_quantity: 2 })];
    render(<ConsumablesPage />, { wrapper });
    const user = userEvent.setup();
    await screen.findByText("قهوة عربية");
    await user.click(screen.getByRole("button", { name: "إتلاف" }));
    await user.type(screen.getByPlaceholderText("0.000"), "5");
    await user.type(screen.getByPlaceholderText("اشرح السبب"), "سبب");
    await user.click(screen.getByRole("button", { name: "تسجيل الإتلاف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "الكمية أكبر من الرصيد الحالي (2).",
    );
    expect(rpcCalls.length).toBe(0);
  });

  it("hides adjustment from WAREHOUSE and shows it to MANAGER", async () => {
    state.stock = [stockRow()];
    const { unmount } = render(<ConsumablesPage />, { wrapper });
    await screen.findByText("قهوة عربية");
    expect(screen.queryByRole("button", { name: "تعديل الرصيد" })).not.toBeInTheDocument();
    unmount();

    authState.role = "MANAGER";
    render(<ConsumablesPage />, { wrapper });
    await screen.findByText("قهوة عربية");
    expect(screen.getByRole("button", { name: "تعديل الرصيد" })).toBeInTheDocument();
  });

  it("sends a signed negative adjustment after reason + confirmation", async () => {
    authState.role = "MANAGER";
    state.stock = [stockRow({ on_hand_quantity: 10 })];
    render(<ConsumablesPage />, { wrapper });
    const user = userEvent.setup();
    await screen.findByText("قهوة عربية");
    await user.click(screen.getByRole("button", { name: "تعديل الرصيد" }));
    await user.selectOptions(screen.getByRole("combobox"), "نقصان");
    await user.type(screen.getByPlaceholderText("0.000"), "1.5");
    await user.type(screen.getByPlaceholderText("اشرح السبب"), "تصحيح جرد");
    await user.click(screen.getByRole("button", { name: "تنفيذ التعديل" }));
    expect(
      screen.getByText("تأكيد نهائي: هذه العملية تغيّر الرصيد الفعلي ولا يمكن حذفها."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "نعم، تنفيذ" }));
    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === "adjust_consumable_stock");
      expect(call).toBeDefined();
      expect(call?.args.p_quantity).toBe(-1.5);
      expect(call?.args.p_reason).toBe("تصحيح جرد");
    });
  });

  it("maps a server rejection to Arabic without leaking SQL", async () => {
    state.stock = [stockRow()];
    state.rpcError = "CONSUMABLE_TRACKING_INACTIVE at line 3 of plpgsql";
    render(<ConsumablesPage />, { wrapper });
    const user = userEvent.setup();
    await screen.findByText("قهوة عربية");
    await user.click(screen.getByRole("button", { name: "استلام" }));
    await user.type(screen.getByPlaceholderText("0.000"), "1");
    await user.click(screen.getByRole("button", { name: "تأكيد الاستلام" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("تتبع هذا الصنف موقوف. فعّل التتبع أولاً.");
    expect(alert.textContent).not.toContain("plpgsql");
  });

  it("surfaces defective balance rows instead of fake zeros", async () => {
    state.stock = [stockRow({ on_hand_quantity: null })];
    render(<ConsumablesPage />, { wrapper });
    expect(
      await screen.findByText(/بيانات غير مكتملة في 1 صنف/),
    ).toBeInTheDocument();
    expect(screen.queryByText("قهوة عربية")).not.toBeInTheDocument();
  });

  it("never renders raw stock UUIDs", async () => {
    state.stock = [
      stockRow({ stock_item_id: "3f7c9a10-1111-2222-3333-444444444444" }),
    ];
    const { container } = render(<ConsumablesPage />, { wrapper });
    await screen.findByText("قهوة عربية");
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });
});
