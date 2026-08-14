import { useState } from "react";
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
  selling_price: 3,
  status: "ACTIVE",
  sort_order: 0,
  created_at: "",
  updated_at: "",
  cost_price: 1.5,
  internal_notes: null,
};

const itemB: CatalogListItem = {
  ...itemA,
  id: "b",
  name: "تمر",
  selling_price: 5,
  cost_price: 2.5,
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
    // Money is written in the `numeric(12,3)` transport shape the generated
    // types declare (a JSON number), produced losslessly from milli-OMR.
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cost_price: 2.5, selling_price: 5 }),
    );
  });
});

/** A harness that can close and reopen the same dialog without remounting. */
function ToggleHarness({ initial }: { initial: CatalogListItem | null }) {
  const [open, setOpen] = useState(true);
  const [item] = useState(initial);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <button onClick={() => setOpen(false)}>close-harness</button>
      <button onClick={() => setOpen(true)}>reopen-harness</button>
      <CatalogItemDialog
        open={open}
        onOpenChange={setOpen}
        orgId="org"
        categories={[]}
        item={item}
      />
    </QueryClientProvider>
  );
}

describe("CatalogItemDialog — cancel + reopen reset", () => {
  it("resets edited values when an item is cancelled and reopened", async () => {
    const user = userEvent.setup();
    render(<ToggleHarness initial={itemA} />);

    const name = () => screen.getByLabelText(/الاسم \(عربي\)/) as HTMLInputElement;
    const selling = () => screen.getByLabelText(/سعر البيع/) as HTMLInputElement;

    expect(name().value).toBe("قهوة");
    await user.clear(name());
    await user.type(name(), "قهوة معدلة");
    await user.clear(selling());
    await user.type(selling(), "9.999");
    expect(name().value).toBe("قهوة معدلة");
    expect(selling().value).toBe("9.999");

    // Cancel (dialog close) then reopen the SAME item.
    await user.click(screen.getByRole("button", { name: "إلغاء" }));
    await user.click(screen.getByRole("button", { name: "reopen-harness" }));

    expect(name().value).toBe("قهوة");
    expect(selling().value).toBe("3.000");
    expect((screen.getByLabelText(/سعر التكلفة/) as HTMLInputElement).value).toBe("1.500");
  });

  it("resets a new-item form after cancel and reopen", async () => {
    const user = userEvent.setup();
    render(<ToggleHarness initial={null} />);

    const name = () => screen.getByLabelText(/الاسم \(عربي\)/) as HTMLInputElement;
    await user.type(name(), "صنف مؤقت");
    expect(name().value).toBe("صنف مؤقت");

    await user.click(screen.getByRole("button", { name: "إلغاء" }));
    await user.click(screen.getByRole("button", { name: "reopen-harness" }));

    expect(name().value).toBe("");
    expect((screen.getByLabelText(/سعر التكلفة/) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/سعر البيع/) as HTMLInputElement).value).toBe("");
  });
});
