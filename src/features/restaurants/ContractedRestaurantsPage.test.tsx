import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ContractedRestaurantsPage } from "./ContractedRestaurantsPage";

const state = vi.hoisted(() => ({
  auth: {
    currentOrganization: { id: "org-1", name: "شركة الأصالة" },
    currentRole: "OWNER",
    canReadCost: true,
  },
  restaurants: [] as any[],
  contracts: [] as any[],
  bookings: [] as any[],
}));

vi.mock("@/app/authContext", () => ({
  useAuth: () => state.auth,
}));

vi.mock("@/features/events/events.api", () => ({
  useEvents: () => ({
    data: [],
    isLoading: false,
  }),
}));

vi.mock("./restaurants.db", () => ({
  listCateringRestaurants: vi.fn(() => Promise.resolve(state.restaurants)),
  listContracts: vi.fn(() => Promise.resolve(state.contracts)),
  listMealBookings: vi.fn(() => Promise.resolve(state.bookings)),
  createContract: vi.fn(),
  createMealBooking: vi.fn(),
  confirmMealBooking: vi.fn(),
  cancelMealBooking: vi.fn(),
  markMealBookingServed: vi.fn(),
  endContract: vi.fn(),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ContractedRestaurantsPage />
    </QueryClientProvider>
  );
}

describe("ContractedRestaurantsPage", () => {
  beforeEach(() => {
    state.auth = {
      currentOrganization: { id: "org-1", name: "شركة الأصالة" },
      currentRole: "OWNER",
      canReadCost: true,
    };
    state.restaurants = [];
    state.contracts = [];
    state.bookings = [];
  });

  it("shows access restricted message when user lacks cost visibility", () => {
    state.auth.canReadCost = false;
    renderPage();
    expect(
      screen.getByText("المطاعم المتعاقدة متاحة للصلاحيات المالية فقط.")
    ).toBeInTheDocument();
  });

  it("renders page header and empty stats when data loads", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("المطاعم المتعاقدة")).toBeInTheDocument();
    });

    expect(screen.getByText("عقود سارية")).toBeInTheDocument();
  });

  it("displays restaurant contracts and bookings", async () => {
    state.restaurants = [
      {
        supplier_id: "sup-1",
        organization_id: "org-1",
        name: "مطعم الضيافة العماني",
        category: "CATERING_RESTAURANT",
        phone: "+96891000000",
        whatsapp: null,
        contact_name: "سعيد",
        status: "ACTIVE",
      },
    ];
    state.contracts = [
      {
        contract_id: "con-1",
        organization_id: "org-1",
        supplier_id: "sup-1",
        supplier_name: "مطعم الضيافة العماني",
        category: "CATERING_RESTAURANT",
        contract_number: "CTR-101",
        starts_on: "2026-01-01",
        ends_on: "2026-12-31",
        lunch_unit_price: 3.5,
        dinner_unit_price: 4.5,
        minimum_guests: 20,
        cut_off_hours: 24,
        payment_terms: null,
        notes: "عقد توريد وجبات",
        status: "ACTIVE",
        ended_at: null,
        currently_valid: true,
      },
    ];
    state.bookings = [
      {
        booking_id: "b-1",
        organization_id: "org-1",
        event_id: "ev-1",
        event_number: "EV-501",
        event_title: "حفل عشاء شركة الأصالة",
        supplier_id: "sup-1",
        supplier_name: "مطعم الضيافة العماني",
        contract_id: "con-1",
        contract_number: "CTR-101",
        meal_type: "DINNER",
        service_date: "2026-09-15",
        guest_count: 80,
        unit_price: 4.5,
        total_amount: 360,
        menu_summary: "عشاء عماني فاخر",
        notes: null,
        status: "PENDING",
        confirmed_at: null,
        cancelled_at: null,
        cancellation_reason: null,
        served_at: null,
        created_at: "2026-09-10T10:00:00.000Z",
      },
    ];

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText("مطعم الضيافة العماني")[0]).toBeInTheDocument();
      expect(screen.getByText("حفل عشاء شركة الأصالة")).toBeInTheDocument();
    });
  });
});
