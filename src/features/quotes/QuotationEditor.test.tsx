import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuotationEditor } from "./QuotationEditor";

const testState = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  quote: null as Record<string, unknown> | null,
  lines: [] as Array<Record<string, unknown>>,
}));

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "qt-1", organization_id: "org", event_id: null, quotation_number: null,
    revision: 1, status: "DRAFT", customer_id: null,
    customer_name_snapshot: "مريم", customer_phone_snapshot: null,
    prospect_whatsapp: null, prospect_company: null, event_number_snapshot: null,
    event_title_snapshot: "مريم", event_type_snapshot: "OTHER", guest_count_snapshot: null,
    start_at_snapshot: null, end_at_snapshot: null, venue_snapshot: null,
    location_snapshot: null, terms: null, notes: null, total_selling: "0.000",
    issued_at: null, accepted_at: null, converted_event_id: null,
    created_at: "2026-08-16T00:00:00Z", updated_at: "2026-08-16T00:00:00Z",
    ...overrides,
  };
}

function persistedLine(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-1", organization_id: "org", quotation_id: "qt-1",
    source_catalog_item_id: null, source_package_id: null, description: "خدمة محفوظة",
    item_type: "SERVICE", unit: "مناسبة", pricing_method: "FIXED", quantity: "1.000",
    unit_selling_price: "25.000", expected_unit_cost: "10.000", total_selling: "25.000",
    total_expected_cost: "10.000", is_custom: true, notes: null, sort_order: 0,
    ...overrides,
  };
}

const rpcMock = vi.fn(async (name: string, args: Record<string, unknown>) => {
  testState.rpcCalls.push({ name, args });
  if (name === "create_quotation_draft") {
    testState.quote = draftRow({ customer_name_snapshot: args.p_prospect_name });
    return { data: testState.quote, error: null };
  }
  if (name === "save_quotation_draft") {
    const input = args.p_lines as Array<Record<string, unknown>>;
    testState.quote = draftRow({
      customer_name_snapshot: args.p_prospect_name,
      guest_count_snapshot: args.p_guest_count,
      venue_snapshot: args.p_venue_name,
    });
    testState.lines = input.map((line, index) => persistedLine({
      id: line.id ?? `saved-line-${index + 1}`,
      description: line.description,
      item_type: line.item_type,
      unit: line.unit,
      pricing_method: line.pricing_method,
      quantity: line.quantity,
      unit_selling_price: line.unit_selling_price,
      expected_unit_cost: line.expected_unit_cost,
      is_custom: line.is_custom,
      source_catalog_item_id: line.source_catalog_item_id,
      source_package_id: line.source_package_id,
      sort_order: index,
    }));
    return { data: testState.quote, error: null };
  }
  if (name === "issue_quotation") {
    return { data: { ...draftRow(), status: "ISSUED", quotation_number: "QT-2026-00001" }, error: null };
  }
  return { data: null, error: null };
});

function builderFor(table: string) {
  const staticData: Record<string, unknown[]> = {
    packages: [{ id: "p1", organization_id: "org", name: "باقة القهوة", status: "ACTIVE", base_guest_count: 50 }],
    package_items: [{ package_id: "p1", catalog_item_id: "c1", quantity: "1", sort_order: 0 }],
    catalog_items: [{
      id: "c1", organization_id: "org", name: "قهوة", item_type: "SERVICE", unit: "ضيف",
      pricing_method: "PER_GUEST", selling_price: "2.800", cost_price: "1.250", status: "ACTIVE",
    }],
    catalog_items_operational: [{
      id: "c1", organization_id: "org", name: "قهوة", item_type: "SERVICE", unit: "ضيف",
      pricing_method: "PER_GUEST", selling_price: "2.800", status: "ACTIVE",
    }],
  };
  const rows = table === "quotations_customer"
    ? (testState.quote ? [testState.quote] : [])
    : table === "quotation_lines_customer" ? testState.lines : (staticData[table] ?? []);
  const chain = {
    select: () => chain, eq: () => chain, order: () => chain,
    single: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
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
    currentOrganization: { id: "org", name: "Org A" }, currentRole: "OWNER",
    canManageCommercial: true, canReadCost: true,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

function renderEditor(draftId?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuotationEditor draftId={draftId} />
    </QueryClientProvider>,
  );
}

async function addCustomLine(user: ReturnType<typeof userEvent.setup>, description = "تصوير") {
  await user.type(screen.getByLabelText(/^الوصف$/), description);
  await user.type(screen.getByLabelText(/^الكمية$/), "1");
  await user.type(screen.getByLabelText(/سعر الوحدة/), "100");
  await user.click(screen.getByRole("button", { name: "إضافة خدمة" }));
}

beforeEach(() => {
  testState.rpcCalls.length = 0;
  testState.quote = null;
  testState.lines = [];
  rpcMock.mockClear();
});

describe("QuotationEditor", () => {
  it("is one focused page with three clear sections", () => {
    renderEditor();
    expect(screen.getByRole("heading", { name: /١\. بيانات بسيطة/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /٢\. الخدمات والسعر/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /٣\. مراجعة وإرسال/ })).toBeInTheDocument();
  });

  it("creates no records on mount and disables issue without services", async () => {
    renderEditor();
    await waitFor(() => expect(testState.rpcCalls).toHaveLength(0));
    expect(screen.getByRole("button", { name: "إصدار عرض السعر" })).toBeDisabled();
  });

  it("persists a new custom line on Save Draft without issuing", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText(/اسم العميل \/ المتوقع/), "مريم");
    await addCustomLine(user);
    await user.click(screen.getByRole("button", { name: "حفظ المسودة" }));
    await waitFor(() => expect(testState.rpcCalls.some((call) => call.name === "save_quotation_draft")).toBe(true));
    expect(testState.rpcCalls[0]?.name).toBe("create_quotation_draft");
    expect(testState.rpcCalls.some((call) => call.name === "issue_quotation")).toBe(false);
    expect((testState.rpcCalls.find((call) => call.name === "save_quotation_draft")?.args.p_lines as unknown[])).toHaveLength(1);
    expect(testState.lines).toHaveLength(1);
  });

  it("reopens a saved draft with its persisted lines", async () => {
    const user = userEvent.setup();
    const first = renderEditor();
    await user.type(screen.getByLabelText(/اسم العميل \/ المتوقع/), "مريم");
    await addCustomLine(user, "بوفيه محفوظ");
    await user.click(screen.getByRole("button", { name: "حفظ المسودة" }));
    await waitFor(() => expect(testState.lines).toHaveLength(1));
    first.unmount();
    renderEditor("qt-1");
    expect(await screen.findByDisplayValue("بوفيه محفوظ")).toBeInTheDocument();
    expect(screen.getByLabelText("سعر خدمة بوفيه محفوظ")).toHaveValue("100");
  });

  it("deleting a persisted line then saving removes it from storage", async () => {
    testState.quote = draftRow();
    testState.lines = [persistedLine()];
    const user = userEvent.setup();
    renderEditor("qt-1");
    await user.click(await screen.findByRole("button", { name: "حذف خدمة خدمة محفوظة" }));
    await user.click(screen.getByRole("button", { name: "حفظ المسودة" }));
    await waitFor(() => expect(testState.lines).toHaveLength(0));
    const save = testState.rpcCalls.find((call) => call.name === "save_quotation_draft");
    expect(save?.args.p_lines).toEqual([]);
  });

  it("editing a persisted line then saving replaces persisted commercial state", async () => {
    testState.quote = draftRow();
    testState.lines = [persistedLine()];
    const user = userEvent.setup();
    renderEditor("qt-1");
    const quantity = await screen.findByLabelText("كمية خدمة خدمة محفوظة");
    const price = screen.getByLabelText("سعر خدمة خدمة محفوظة");
    await user.clear(quantity);
    await user.type(quantity, "2.500");
    await user.clear(price);
    await user.type(price, "30.125");
    await user.click(screen.getByRole("button", { name: "حفظ المسودة" }));
    await waitFor(() => expect(testState.lines[0]?.quantity).toBe("2.500"));
    expect(testState.lines[0]?.unit_selling_price).toBe("30.125");
    expect(testState.lines[0]?.expected_unit_cost).toBe("10.000");
  });

  it("repeated Save Draft replaces the collection without duplicate lines", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText(/اسم العميل \/ المتوقع/), "مريم");
    await addCustomLine(user);
    await user.click(screen.getByRole("button", { name: "حفظ المسودة" }));
    await waitFor(() => expect(testState.lines).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "حفظ المسودة" }));
    await waitFor(() => expect(testState.rpcCalls.filter((call) => call.name === "save_quotation_draft")).toHaveLength(2));
    expect(testState.lines).toHaveLength(1);
  });

  it("persists package provenance and expected cost", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText(/اسم العميل \/ المتوقع/), "مريم");
    await user.type(screen.getByLabelText(/عدد الضيوف/), "20");
    await user.selectOptions(await screen.findByLabelText(/باقة جاهزة/), "p1");
    await user.click(screen.getByRole("button", { name: "تطبيق الباقة" }));
    await user.click(screen.getByRole("button", { name: "حفظ المسودة" }));
    await waitFor(() => expect(testState.lines).toHaveLength(1));
    expect(testState.lines[0]).toMatchObject({
      source_catalog_item_id: "c1", source_package_id: "p1", expected_unit_cost: "1.250",
      pricing_method: "PER_GUEST", quantity: "1.000", unit_selling_price: "2.800",
    });
  });

  it("uses the same aggregate persistence path before issue", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText(/اسم العميل \/ المتوقع/), "محمد");
    await addCustomLine(user);
    await user.click(screen.getByRole("button", { name: "إصدار عرض السعر" }));
    await user.click(await screen.findByRole("button", { name: "تأكيد الإصدار" }));
    await waitFor(() => expect(testState.rpcCalls.some((call) => call.name === "issue_quotation")).toBe(true));
    expect(testState.rpcCalls.map((call) => call.name)).toEqual([
      "create_quotation_draft", "save_quotation_draft", "issue_quotation",
    ]);
  });

  it("warns when a per-guest service has no guest count", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText(/^الوصف$/), "بوفيه");
    await user.selectOptions(screen.getByLabelText(/طريقة التسعير/), "PER_GUEST");
    await user.type(screen.getByLabelText(/^الكمية$/), "1");
    await user.type(screen.getByLabelText(/سعر الوحدة/), "2.800");
    await user.click(screen.getByRole("button", { name: "إضافة خدمة" }));
    expect(screen.getByText(/حدد عدد الضيوف أولاً/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حفظ المسودة" })).toBeDisabled();
  });
});
