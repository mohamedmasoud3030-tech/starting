import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProcurementPage } from "./ProcurementPage";
import { useAuth } from "@/app/authContext";
import { useEvents } from "@/features/events/events.api";

vi.mock("@/app/authContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/features/events/events.api", () => ({
  useEvents: vi.fn(),
}));

vi.mock("./supabaseDataSource", () => ({
  createSupabaseProcurementDataSource: vi.fn(() => ({
    getAccess: vi.fn().mockResolvedValue({
      canViewCommercialAmounts: true,
      canCreateSupplier: true,
      canCreateOrder: true,
    }),
    listOrders: vi.fn().mockResolvedValue([]),
    listSuppliers: vi.fn().mockResolvedValue([]),
    listConsumableOptions: vi.fn().mockResolvedValue([]),
    getSupplier: vi.fn(),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    deactivateSupplier: vi.fn(),
    getOrder: vi.fn(),
    createOrder: vi.fn(),
    approveOrder: vi.fn(),
    sendOrder: vi.fn(),
    confirmOrder: vi.fn(),
    cancelOrder: vi.fn(),
    recordReceipt: vi.fn(),
    getEventProcurement: vi.fn(),
  })),
}));

// The page participates in cross-feature cache sync (useProcurementDataSource
// → useQueryClient), so it must render inside a QueryClientProvider — exactly
// as it does in the real app tree.
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("ProcurementPage", () => {
  it("renders the procurement workspace when organization is active", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "u1" } as any,
      session: null,
      profile: null,
      currentMembership: null,
      currentOrganization: { id: "org-1", name: "مكتب مسقط" } as any,
      currentRole: "OWNER",
      memberships: [],
      loading: false,
      error: null,
      canManageCommercial: true,
      canReadCost: true,
      canWriteCustomers: true,
      login: vi.fn(),
      logout: vi.fn(),
      switchOrganization: vi.fn(),
    });

    vi.mocked(useEvents).mockReturnValue({
      data: {
        rows: [{ id: "ev-1", title: "مناسبة العيد", event_number: "EV-01" }],
        total: 1,
      },
      isLoading: false,
    } as any);

    render(<ProcurementPage />, { wrapper });

    expect(screen.getByText("جارٍ تحميل المشتريات…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "الموردون والمشتريات" })).toBeInTheDocument();
  });

  it("hides procurement from roles without financial visibility", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "u1" } as any,
      session: null,
      profile: null,
      currentMembership: null,
      currentOrganization: { id: "org-1", name: "مكتب مسقط" } as any,
      currentRole: "WAREHOUSE",
      memberships: [],
      loading: false,
      error: null,
      canManageCommercial: false,
      canReadCost: false,
      canWriteCustomers: false,
      login: vi.fn(),
      logout: vi.fn(),
      switchOrganization: vi.fn(),
    });

    vi.mocked(useEvents).mockReturnValue({
      data: { rows: [], total: 0 },
      isLoading: false,
    } as any);

    render(<ProcurementPage />, { wrapper });

    expect(
      screen.getByText("المشتريات والموردون متاحة للصلاحيات المالية فقط."),
    ).toBeInTheDocument();
  });

  it("shows fallback message when no organization is active", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "u1" } as any,
      session: null,
      profile: null,
      currentMembership: null,
      currentOrganization: null,
      currentRole: null,
      memberships: [],
      loading: false,
      error: null,
      canManageCommercial: false,
      canReadCost: false,
      canWriteCustomers: false,
      login: vi.fn(),
      logout: vi.fn(),
      switchOrganization: vi.fn(),
    });

    vi.mocked(useEvents).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);

    render(<ProcurementPage />, { wrapper });

    expect(screen.getByText("اختر منظمة لعرض المشتريات والموردين.")).toBeInTheDocument();
  });
});
