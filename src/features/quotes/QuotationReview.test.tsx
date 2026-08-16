import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuotationReview } from "./QuotationReview";

// ---------------------------------------------------------------------------
// Mocks: no real Supabase, no router, controllable auth (role swap per test).
// ---------------------------------------------------------------------------
const authMock = vi.hoisted(() =>
  vi.fn(() => ({
    currentOrganization: { id: "org", name: "Org A" },
    currentRole: "OWNER" as string,
    canManageCommercial: true,
    canReadCost: true,
  })),
);

const state = vi.hoisted(() => ({
  quotationStatus: "ISSUED" as "ISSUED" | "ACCEPTED" | "SUPERSEDED",
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

const rpcMock = vi.hoisted(() =>
  vi.fn(async (name: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ name, args });
    const data =
      name === "accept_quotation"
        ? { id: "qt-1", status: "ACCEPTED" }
        : name === "convert_quotation_to_event"
          ? { id: "ev-1" }
          : null;
    return { data, error: null };
  }),
);

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => {
  const quotationRow = (status: string) => ({
    id: "qt-1", organization_id: "org", event_id: null,
    quotation_number: "QT-2026-00001", revision: 1, status,
    customer_id: null, customer_name_snapshot: "محمد", customer_phone_snapshot: "91234567",
    prospect_whatsapp: null, prospect_company: null, event_number_snapshot: null,
    event_title_snapshot: "زفاف", event_type_snapshot: "WEDDING", guest_count_snapshot: 120,
    start_at_snapshot: "2026-09-01T10:00:00+04:00", end_at_snapshot: "2026-09-01T14:00:00+04:00",
    venue_snapshot: "قاعة الريان", location_snapshot: null, terms: null, notes: null,
    total_selling: "850.000", issued_at: "2026-08-14T00:00:00Z", accepted_at: null,
    converted_event_id: null, created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z",
  });
  function builderFor(table: string) {
    const rows: unknown[] = table === "quotations_customer"
      ? [quotationRow(state.quotationStatus)]
      : table === "quotation_lines_customer" ? [{
          id: "l1", organization_id: "org", quotation_id: "qt-1",
          source_catalog_item_id: null, source_package_id: null, description: "بوفيه",
          item_type: "SERVICE", unit: "ضيف", pricing_method: "PER_GUEST", quantity: "1",
          unit_selling_price: "7.083", expected_unit_cost: null, total_selling: "850.000", total_expected_cost: null, is_custom: true, notes: null, sort_order: 0,
        }] : [];
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain,
      single: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
    };
    return chain;
  }
  return { isSupabaseConfigured: true, supabase: {
    rpc: (name: string, args: Record<string, unknown>) => rpcMock(name, args),
    from: (table: string) => builderFor(table),
  }};
});

vi.mock("@/app/AuthContext", () => ({
  useAuth: () => authMock(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

function renderReview() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <QuotationReview quoteId="qt-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.quotationStatus = "ISSUED";
  state.rpcCalls.length = 0;
  rpcMock.mockClear();
  navigateMock.mockClear();
  authMock.mockReset();
  authMock.mockReturnValue({
    currentOrganization: { id: "org", name: "Org A" },
    currentRole: "OWNER",
    canManageCommercial: true,
    canReadCost: true,
  });
});

describe("QuotationReview", () => {
  it("shows the immutable quotation (snapshot + lines + exact total)", async () => {
    renderReview();
    expect(await screen.findByText("QT-2026-00001 · مراجعة 1")).toBeInTheDocument();
    expect(screen.getByText("محمد")).toBeInTheDocument();
    expect(screen.getByText("قاعة الريان")).toBeInTheDocument();
    expect(screen.getByText("بوفيه")).toBeInTheDocument();
    expect(screen.getAllByText("850.000 ر.ع.").length).toBeGreaterThan(0);
  });

  it("offers the Owner Voice control and never speaks automatically", async () => {
    renderReview();
    // jsdom has no speechSynthesis → the control renders its unsupported
    // state and nothing was spoken or sent anywhere.
    const voiceButton = await screen.findByRole("button", {
      name: "القراءة الصوتية غير مدعومة",
    });
    expect(voiceButton).toBeDisabled();
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("accepts an ISSUED quotation", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(await screen.findByRole("button", { name: "اعتماد العرض" }));
    await waitFor(() =>
      expect(state.rpcCalls.some((c) => c.name === "accept_quotation")).toBe(true),
    );
  });

  it("converts an ACCEPTED quotation into an Event (dialog prefilled)", async () => {
    state.quotationStatus = "ACCEPTED";
    const user = userEvent.setup();
    renderReview();

    await user.click(
      await screen.findByRole("button", { name: "تأكيد الحجز / تحويل إلى مناسبة" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText(/اسم المناسبة/)).toHaveValue("زفاف");
    expect(screen.getByLabelText(/الموقع/)).toHaveValue("قاعة الريان");

    await user.click(screen.getByRole("button", { name: "تأكيد التحويل" }));
    await waitFor(() =>
      expect(state.rpcCalls.some((c) => c.name === "convert_quotation_to_event")).toBe(true),
    );
    const convertCall = state.rpcCalls.find((c) => c.name === "convert_quotation_to_event");
    expect(convertCall?.args.p_quotation_id).toBe("qt-1");
    expect(convertCall?.args.p_venue_name).toBe("قاعة الريان");
    expect(convertCall?.args.p_guest_count).toBe(120);
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/events/$eventId",
        params: { eventId: "ev-1" },
      }),
    );
  });

  it("hides accept/convert actions for non-commercial roles", async () => {
    authMock.mockReturnValue({
      currentOrganization: { id: "org", name: "Org A" },
      currentRole: "SUPERVISOR",
      canManageCommercial: false,
      canReadCost: false,
    });
    renderReview();
    await screen.findByText("QT-2026-00001 · مراجعة 1");
    expect(
      screen.queryByRole("button", { name: "اعتماد العرض" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "تأكيد الحجز / تحويل إلى مناسبة" }),
    ).not.toBeInTheDocument();
  });
});
