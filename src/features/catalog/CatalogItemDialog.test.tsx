import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogItemDialog } from "./CatalogItemDialog";
import type { CatalogListItem } from "./catalog.api";

// Capture the last update payload so tests can assert exactly what was saved.
const updateSpy = vi.fn().mockResolvedValue({ data: {}, error: null });

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: {}, error: null }) }) }),
      update: (vals: unknown) => ({
        eq: () => ({
          select: () => ({ single: () => updateSpy(vals) }),
        }),
      }),
    }),
  },
}));

const itemA: CatalogListItem = {
  id: "a",
  organization_id: "org",
  category_id: null,
  code: null,
  name: "قهوة",
  name_en: null,
  description: null,
  item_type: "SERVICE",
  unit: "ضيف",
  pricing_method: "PER_GUEST",
  selling_price: "3.000",
  status: "ACTIVE",
  sort_order: 0,
  created_at: "",
  updated_at: "",
  cost_price: "1.500",
  internal_notes: null,
};

const itemB: CatalogListItem = {
  ...itemA,
  id: "b",
  name: "تمر",
  selling_price: "5.000",
  cost_price: "2.500",
};

function renderDialog(item: CatalogListItem | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CatalogItemDialog
        open
        onOpenChange={() => {}}
        orgId="org"
        categories={[]}
        item={item}
      />
    </QueryClientProvider>,
  );
  return utils;
}

describe("CatalogItemDialog — money value synchronization", () => {
  beforeEach(() => {
    updateSpy.mockClear();
  });

  it("renders the create form with Arabic labels", () => {
    renderDialog(null);
    expect(screen.getByText("صنف جديد")).toBeInTheDocument();
    expect(screen.getByLabelText(/الاسم \(عربي\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/سعر التكلفة/)).toBeInTheDocument();
    expect(screen.getByLabelText(/سعر البيع/)).toBeInTheDocument();
  });

  it("shows a validation error when the name is empty", async () => {
    const user = userEvent.setup();
    renderDialog(null);
    await user.click(screen.getByRole("button", { name: "حفظ" }));
    expect(await screen.findByText("الاسم مطلوب")).toBeInTheDocument();
  });

  it("re-syncs cost and selling price when the target item changes", () => {
    const { rerender } = renderDialog(itemA);
    expect((screen.getByLabelText(/سعر التكلفة/) as HTMLInputElement).value).toBe("1.500");
    expect((screen.getByLabelText(/سعر البيع/) as HTMLInputElement).value).toBe("3.000");

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CatalogItemDialog
          open
          onOpenChange={() => {}}
          orgId="org"
          categories={[]}
          item={itemB}
        />
      </QueryClientProvider>,
    );

    expect((screen.getByLabelText(/سعر التكلفة/) as HTMLInputElement).value).toBe("2.500");
    expect((screen.getByLabelText(/سعر البيع/) as HTMLInputElement).value).toBe("5.000");
  });

  it("submits item B's prices (never stale item A values)", async () => {
    const user = userEvent.setup();
    renderDialog(itemB);
    await user.click(screen.getByRole("button", { name: "حفظ" }));
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cost_price: "2.500", selling_price: "5.000" }),
    );
  });
});
