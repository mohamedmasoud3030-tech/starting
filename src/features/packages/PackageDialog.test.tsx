import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PackageDialog } from "./PackageDialog";
import type { PackageWithLines } from "./packages.api";

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: async () => ({ data: "pkg-id", error: null }),
  },
}));

const target: PackageWithLines = {
  package: {
    id: "pkg-1",
    organization_id: "org",
    name: "ضيافة قهوة",
    name_en: null,
    description: null,
    status: "ACTIVE",
    base_guest_count: 100,
    created_at: "",
    updated_at: "",
  },
  lines: [
    {
      id: "pl-1",
      organization_id: "org",
      package_id: "pkg-1",
      catalog_item_id: "cat-1",
      quantity: 3,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    },
  ],
};

const catalogItems = [
  {
    id: "cat-1",
    organization_id: "org",
    category_id: null,
    code: null,
    name: "قهوة عمانية",
    name_en: null,
    description: null,
    item_type: "SERVICE" as const,
    unit: "ضيف",
    pricing_method: "PER_GUEST" as const,
    selling_price: 3,
    status: "ACTIVE" as const,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    cost_price: "1.500",
    internal_notes: null,
  },
];

function ToggleHarness() {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <button onClick={() => setOpen(false)}>close-harness</button>
      <button onClick={() => setOpen(true)}>reopen-harness</button>
      <PackageDialog
        open={open}
        onOpenChange={setOpen}
        orgId="org"
        catalogItems={catalogItems}
        target={target}
      />
    </QueryClientProvider>
  );
}

describe("PackageDialog — cancel + reopen reset", () => {
  it("resets edited package name after cancel and reopen", async () => {
    const user = userEvent.setup();
    render(<ToggleHarness />);

    const name = () => screen.getByLabelText(/اسم الباقة/) as HTMLInputElement;
    expect(name().value).toBe("ضيافة قهوة");

    await user.clear(name());
    await user.type(name(), "اسم معدل");
    expect(name().value).toBe("اسم معدل");

    await user.click(screen.getByRole("button", { name: "إلغاء" }));
    await user.click(screen.getByRole("button", { name: "reopen-harness" }));

    expect((screen.getByLabelText(/اسم الباقة/) as HTMLInputElement).value).toBe(
      "ضيافة قهوة",
    );
  });
});
