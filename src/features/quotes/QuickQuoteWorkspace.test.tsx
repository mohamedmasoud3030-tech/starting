import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuickQuoteWorkspace } from "./QuickQuoteWorkspace";

// ---------------------------------------------------------------------------
// Mocks: no real Supabase, no router, fixed auth (OWNER).
// ---------------------------------------------------------------------------
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const rpcMock = vi.fn(async (name: string, args: Record<string, unknown>) => {
  rpcCalls.push({ name, args });
  const data =
    name === "create_quick_quote"
      ? { id: "qq-1", organization_id: "org", status: "DRAFT", prospect_name: args.p_prospect_name }
      : name === "issue_quick_quote"
        ? { id: "qt-1", quotation_number: "QT-2026-00001" }
        : name === "save_quick_quote_line"
          ? { id: `line-${rpcCalls.length}` }
          : null;
  return { data, error: null };
});

function builderFor(table: string) {
  const data: Record<string, unknown[]> = {
    packages: [
      {
        id: "p1",
        organization_id: "org",
        name: "باقة القهوة",
        status: "ACTIVE",
        base_guest_count: 50,
      },
    ],
    package_items: [
      { package_id: "p1", catalog_item_id: "c1", quantity: "1", sort_order: 0 },
    ],
    catalog_items_operational: [
      {
        id: "c1",
        organization_id: "org",
        name: "قهوة",
        item_type: "SERVICE",
        unit: "ضيف",
        pricing_method: "PER_GUEST",
        selling_price: "2.800",
        status: "ACTIVE",
      },
    ],
    quick_quotes: [],
    quick_quote_lines: [],
  };
  const rows = data[table] ?? [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    single: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  };
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => rpcMock(name, args),
    from: (table: string) => builderFor(table),
  },
}));

vi.mock("@/app/AuthContext", () => ({
  useAuth: () => ({
    currentOrganization: { id: "org", name: "Org A" },
    currentRole: "OWNER",
    canManageCommercial: true,
    canReadCost: true,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuickQuoteWorkspace />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcCalls.length = 0;
  rpcMock.mockClear();
});

describe("QuickQuoteWorkspace (عرض سعر سريع)", () => {
  it("is ONE focused page with three clear sections, not a multi-page wizard", () => {
    renderWorkspace();
    expect(screen.getByRole("heading", { name: /١\. بيانات بسيطة/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /٢\. الخدمات والسعر/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /٣\. مراجعة وإرسال/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إصدار عرض السعر" })).toBeInTheDocument();
  });

  it("creates NO records on mount and disables issue without services", async () => {
    renderWorkspace();
    await waitFor(() => expect(rpcCalls).toHaveLength(0));
    expect(screen.getByRole("button", { name: "إصدار عرض السعر" })).toBeDisabled();
  });

  it("adds a custom line and updates the live total without any server call", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.type(screen.getByLabelText(/الوصف/), "تصوير");
    await user.type(screen.getByLabelText(/الكمية/), "1");
    await user.type(screen.getByLabelText(/سعر الوحدة/), "150");
    await user.click(screen.getByRole("button", { name: "إضافة خدمة" }));

    expect(screen.getByText("تصوير")).toBeInTheDocument();
    expect(screen.getAllByText("150.000 ر.ع.").length).toBeGreaterThan(0);
    expect(rpcCalls).toHaveLength(0); // the live total is client-side only
  });

  it("applies a package client-side as snapshot lines (no server call)", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "باقة القهوة" })).toBeInTheDocument(),
    );
    await user.selectOptions(screen.getByLabelText(/باقة جاهزة/), "p1");
    await user.click(screen.getByRole("button", { name: "تطبيق الباقة" }));

    expect(screen.getByText("قهوة")).toBeInTheDocument();
    expect(screen.getByText("من باقة")).toBeInTheDocument();
    expect(rpcCalls).toHaveLength(0);
  });

  it("issues: creates draft, saves lines, then issues the quotation", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.type(screen.getByLabelText(/اسم العميل \/ المتوقع/), "محمد");
    await user.type(screen.getByLabelText(/الوصف/), "تصوير");
    await user.type(screen.getByLabelText(/الكمية/), "1");
    await user.type(screen.getByLabelText(/سعر الوحدة/), "100");
    await user.click(screen.getByRole("button", { name: "إضافة خدمة" }));

    await user.click(screen.getByRole("button", { name: "إصدار عرض السعر" }));

    await waitFor(() => {
      const names = rpcCalls.map((c) => c.name);
      expect(names).toContain("create_quick_quote");
      expect(names).toContain("save_quick_quote_line");
      expect(names).toContain("issue_quick_quote");
      expect(names[0]).toBe("create_quick_quote");
      expect(names[names.length - 1]).toBe("issue_quick_quote");
    });
    expect(rpcCalls.find((c) => c.name === "create_quick_quote")?.args.p_prospect_name).toBe(
      "محمد",
    );
  });

  it("does not create a Customer or Event during issue (prospect only)", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.type(screen.getByLabelText(/اسم العميل \/ المتوقع/), "سعيد");
    await user.type(screen.getByLabelText(/الوصف/), "خدمة");
    await user.type(screen.getByLabelText(/الكمية/), "1");
    await user.type(screen.getByLabelText(/سعر الوحدة/), "50");
    await user.click(screen.getByRole("button", { name: "إضافة خدمة" }));
    await user.click(screen.getByRole("button", { name: "إصدار عرض السعر" }));
    await waitFor(() =>
      expect(rpcCalls.some((c) => c.name === "issue_quick_quote")).toBe(true),
    );
    const names = rpcCalls.map((c) => c.name);
    expect(names.some((n) => n === "create_event" || n === "save_customer")).toBe(false);
  });

  it("warns when a per-guest service has no guest count yet", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.type(screen.getByLabelText(/الوصف/), "بوفيه");
    await user.selectOptions(screen.getByLabelText(/طريقة التسعير/), "PER_GUEST");
    await user.type(screen.getByLabelText(/الكمية/), "1");
    await user.type(screen.getByLabelText(/سعر الوحدة/), "2.800");
    await user.click(screen.getByRole("button", { name: "إضافة خدمة" }));

    expect(screen.getByText("يُحدد بعد معرفة عدد الضيوف")).toBeInTheDocument();
    expect(screen.getByText(/حدد عدد الضيوف أولاً/)).toBeInTheDocument();
  });
});
