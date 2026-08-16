import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  })),
}));

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
    });

    vi.mocked(useEvents).mockReturnValue({
      data: [{ id: "ev-1", title: "مناسبة العيد", event_number: "EV-01" }],
      isLoading: false,
    } as any);

    render(<ProcurementPage />);

    expect(screen.getByText("جارٍ تحميل المشتريات…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "الموردون والمشتريات" })).toBeInTheDocument();
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
    });

    vi.mocked(useEvents).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);

    render(<ProcurementPage />);

    expect(screen.getByText("اختر منظمة لعرض المشتريات والموردين.")).toBeInTheDocument();
  });
});
