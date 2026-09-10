import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PackagesPage } from "./PackagesPage";

const state = vi.hoisted(() => ({
  auth: {
    currentOrganization: { id: "org-1", name: "شركة الأصالة" },
    currentRole: "OWNER",
    capabilities: new Set(["catalog.manage"]),
  },
  packagesData: [] as any[],
  catalogItemsData: [] as any[],
  isLoading: false,
  error: null as any,
}));

vi.mock("@/app/authContext", () => ({
  useAuth: () => state.auth,
}));

vi.mock("./packages.api", () => ({
  usePackages: () => ({
    data: state.packagesData,
    isLoading: state.isLoading,
    error: state.error,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/features/catalog/catalog.api", () => ({
  useCatalogItems: () => ({
    data: { rows: state.catalogItemsData, total: state.catalogItemsData.length },
    isLoading: false,
  }),
}));

vi.mock("@/features/settings/settings.api", () => ({
  useOrganizationSettings: () => ({
    data: { organization_name: "شركة الأصالة" },
    isLoading: false,
  }),
}));

vi.mock("./PackageDialog", () => ({
  PackageDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="package-dialog">حوار الباقة</div> : null,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PackagesPage />
    </QueryClientProvider>
  );
}

describe("PackagesPage", () => {
  beforeEach(() => {
    state.auth = {
      currentOrganization: { id: "org-1", name: "شركة الأصالة" },
      currentRole: "OWNER",
      capabilities: new Set(["catalog.manage"]),
    };
    state.packagesData = [];
    state.catalogItemsData = [];
    state.isLoading = false;
    state.error = null;
  });

  it("renders empty state when no packages exist", () => {
    renderPage();
    expect(screen.getByText("الباقات")).toBeInTheDocument();
    expect(screen.getByText("لا توجد باقات بعد")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /باقة جديدة/i })[0]).toBeInTheDocument();
  });

  it("renders package list with status badge, guest count, and items", () => {
    state.catalogItemsData = [
      { id: "cat-1", name: "كراسي ملكية" },
      { id: "cat-2", name: "طاولات مستديرة" },
    ];
    state.packagesData = [
      {
        package: {
          id: "pkg-1",
          name: "باقة الأفراح الملكية",
          base_guest_count: 150,
          status: "ACTIVE",
        },
        lines: [
          { id: "l-1", catalog_item_id: "cat-1", quantity: 150 },
          { id: "l-2", catalog_item_id: "cat-2", quantity: 15 },
        ],
      },
    ];

    renderPage();
    expect(screen.getByText("باقة الأفراح الملكية")).toBeInTheDocument();
    expect(screen.getByText("150 ضيف (مرجعي)")).toBeInTheDocument();
    expect(screen.getByText("نشطة")).toBeInTheDocument();
    expect(screen.getByText("كراسي ملكية")).toBeInTheDocument();
    expect(screen.getByText("طاولات مستديرة")).toBeInTheDocument();
  });

  it("opens new package dialog on button click", async () => {
    const user = userEvent.setup();
    renderPage();

    const newBtn = screen.getAllByRole("button", { name: /باقة جديدة/i })[0];
    await user.click(newBtn!);

    expect(screen.getByTestId("package-dialog")).toBeInTheDocument();
  });

  it("hides creation and edit buttons when user lacks catalog.manage capability", () => {
    state.auth.capabilities = new Set();
    state.auth.currentRole = "MEMBER";
    state.packagesData = [
      {
        package: {
          id: "pkg-1",
          name: "باقة الضيافة",
          base_guest_count: 50,
          status: "ACTIVE",
        },
        lines: [],
      },
    ];

    renderPage();
    expect(screen.getByText("باقة الضيافة")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /باقة جديدة/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /تعديل/i })).not.toBeInTheDocument();
  });
});
