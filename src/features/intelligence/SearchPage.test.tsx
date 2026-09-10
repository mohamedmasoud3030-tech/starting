import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SearchResult } from "./intelligence.api";
import { SearchPage } from "./SearchPage";

/**
 * Global search (البحث).
 *
 * Pins the practical contract: nothing is queried for a single character, hits
 * are grouped under Arabic entity headings, and every hit links straight to the
 * right workspace — with an honest "no matches" message otherwise.
 */

const state = vi.hoisted(() => ({
  results: [] as SearchResult[],
  isLoading: false,
  calls: [] as string[],
}));

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({ currentOrganization: { id: "org-1", name: "دار الضيافة" } }),
}));

vi.mock("@/features/settings/settings.api", () => ({
  useOrganizationSettings: () => ({ data: null, isLoading: false }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("./intelligence.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./intelligence.api")>();
  return {
    ...actual,
    useGlobalSearch: (_orgId: string | null, term: string) => {
      state.calls.push(term);
      return {
        // Mirrors the hook's own gate: only 2+ characters trigger a search.
        data: term.trim().length >= 2 ? state.results : [],
        isLoading: term.trim().length >= 2 ? state.isLoading : false,
      };
    },
  };
});

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.results = [];
  state.isLoading = false;
  state.calls = [];
});

describe("SearchPage", () => {
  it("renders the heading and a labelled search input", () => {
    renderSearch();

    expect(screen.getByRole("heading", { name: "البحث" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "البحث" })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/اسم العميل، الهاتف، رقم المناسبة، رقم العرض أو الفاتورة/),
    ).toBeInTheDocument();
  });

  it("does not search or render results for a single character", async () => {
    state.results = [{ entity_type: "customer", entity_id: "cu-1", title: "مريم", subtitle: "", destination: "/customers/$customerId" }];
    renderSearch();

    await userEvent.type(screen.getByRole("textbox", { name: "البحث" }), "م");

    expect(screen.queryByText("مريم")).not.toBeInTheDocument();
    expect(screen.queryByText("لا توجد نتائج مطابقة.")).not.toBeInTheDocument();
  });

  it("states honestly when a real query finds nothing", async () => {
    renderSearch();
    await userEvent.type(screen.getByRole("textbox", { name: "البحث" }), "زينب");

    expect(await screen.findByText("لا توجد نتائج مطابقة.")).toBeInTheDocument();
  });

  it("shows a progress line while the search runs", async () => {
    state.isLoading = true;
    renderSearch();
    await userEvent.type(screen.getByRole("textbox", { name: "البحث" }), "حفل");

    expect(await screen.findByText("جارٍ البحث…")).toBeInTheDocument();
  });

  it("groups hits under Arabic entity headings", async () => {
    state.results = [
      { entity_type: "customer", entity_id: "cu-1", title: "مريم بنت سعيد", subtitle: "+96891112222", destination: "/customers/$customerId" },
      { entity_type: "event", entity_id: "ev-1", title: "حفل زفاف مريم", subtitle: "قاعة السلام", destination: "/events/$eventId" },
      { entity_type: "quote", entity_id: "q-1", title: "عرض رقم Q-100", subtitle: "مريم", destination: "/quotes/$quoteId" },
      { entity_type: "invoice", entity_id: "in-1", title: "فاتورة INV-9", subtitle: "مريم", destination: "/quotes/$quoteId" },
    ];
    renderSearch();
    await userEvent.type(screen.getByRole("textbox", { name: "البحث" }), "مريم");

    for (const heading of ["عميل", "مناسبة", "عرض سعر", "فاتورة"]) {
      expect(await screen.findByRole("heading", { name: heading, level: 2 })).toBeInTheDocument();
    }

    expect(screen.getByRole("link", { name: /مريم بنت سعيد/ })).toHaveAttribute(
      "href",
      "/customers/$customerId",
    );
    expect(screen.getByRole("link", { name: /حفل زفاف مريم/ })).toHaveAttribute(
      "href",
      "/events/$eventId",
    );
  });

  it("keeps each hit under its own entity section", async () => {
    state.results = [
      { entity_type: "customer", entity_id: "cu-1", title: "مريم", subtitle: "", destination: "/customers/$customerId" },
      { entity_type: "event", entity_id: "ev-1", title: "حفل مريم", subtitle: "", destination: "/events/$eventId" },
    ];
    renderSearch();
    await userEvent.type(screen.getByRole("textbox", { name: "البحث" }), "مريم");

    const customersSection = (await screen.findByRole("heading", { name: "عميل", level: 2 }))
      .closest("section") as HTMLElement;
    const eventsSection = screen.getByRole("heading", { name: "مناسبة", level: 2 })
      .closest("section") as HTMLElement;

    expect(within(customersSection).getByText("مريم")).toBeInTheDocument();
    expect(within(customersSection).queryByText("حفل مريم")).not.toBeInTheDocument();
    expect(within(eventsSection).getByText("حفل مريم")).toBeInTheDocument();
  });
});
