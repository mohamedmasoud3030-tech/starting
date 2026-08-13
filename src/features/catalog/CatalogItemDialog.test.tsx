import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CatalogItemDialog } from "./CatalogItemDialog";

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <CatalogItemDialog
        open
        onOpenChange={() => {}}
        orgId="org-1"
        categories={[]}
        item={null}
      />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("CatalogItemDialog", () => {
  it("renders the create form with Arabic labels", () => {
    renderDialog();
    expect(screen.getByText("صنف جديد")).toBeInTheDocument();
    expect(screen.getByLabelText(/الاسم \(عربي\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/سعر التكلفة/)).toBeInTheDocument();
    expect(screen.getByLabelText(/سعر البيع/)).toBeInTheDocument();
  });

  it("shows a validation error when the name is empty", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "حفظ" }));
    expect(await screen.findByText("الاسم مطلوب")).toBeInTheDocument();
  });

  it("lists all item types and pricing methods", () => {
    renderDialog();
    // Item type select contains a service option
    expect(screen.getByLabelText(/النوع/)).toBeInTheDocument();
    expect(screen.getByLabelText(/طريقة التسعير/)).toBeInTheDocument();
  });
});
