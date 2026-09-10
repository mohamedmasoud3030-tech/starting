import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CustomerRow } from "@/lib/dbTypes";
import { CustomersPage } from "./CustomersPage";

/**
 * Customers list (العملاء).
 *
 * Pins the owner-visible rules: the empty-state guidance, the per-row contact
 * details, the write-permission gate, the required-name validation, and the
 * F10 duplicate-phone guard that stops one client splitting into two profiles.
 */

const state = vi.hoisted(() => ({
  canWrite: true,
  rows: [] as CustomerRow[],
  total: 0,
  isLoading: false,
  error: null as unknown,
  saving: false,
}));

const saveMutate = vi.hoisted(() => vi.fn(async () => ({})));
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    currentOrganization: { id: "org-1", name: "دار الضيافة" },
    canWriteCustomers: state.canWrite,
  }),
}));

vi.mock("@/components/ui/toastContext", () => ({
  useToast: () => ({ success: toastSuccess, error: () => {}, info: () => {} }),
}));

vi.mock("./customers.api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./customers.api")>();
  return {
    ...actual,
    useCustomersPage: () => ({
      data: { rows: state.rows, total: state.total },
      isLoading: state.isLoading,
      error: state.error,
      isFetching: false,
      refetch: () => {},
      page: 0,
      pageSize: 50,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
      goToPage: () => {},
      nextPage: () => {},
      previousPage: () => {},
    }),
    useSaveCustomer: () => ({ mutateAsync: saveMutate, isPending: state.saving }),
  };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// PageHeader consumes the organization settings for document identity.
vi.mock("@/features/settings/settings.api", () => ({
  useOrganizationSettings: () => ({ data: null, isLoading: false }),
}));

/** Renders inside a QueryClient (PageHeader reads org settings via react-query). */
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomersPage />
    </QueryClientProvider>,
  );
}

function row(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: "cu-1",
    name: "مريم بنت سعيد",
    phone: "+96891112222",
    whatsapp: null,
    customer_type: "INDIVIDUAL",
    notes: null,
    is_active: true,
    ...overrides,
  } as CustomerRow;
}

beforeEach(() => {
  state.canWrite = true;
  state.rows = [];
  state.total = 0;
  state.isLoading = false;
  state.error = null;
  state.saving = false;
  saveMutate.mockClear();
  toastSuccess.mockClear();
});

describe("CustomersPage — list & empty state", () => {
  it("renders the page heading", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "العملاء" })).toBeInTheDocument();
  });

  it("guides the owner when there are no customers yet", () => {
    renderPage();
    expect(screen.getByText("لا يوجد عملاء بعد")).toBeInTheDocument();
    expect(screen.getByText("أضف العملاء للبدء بتنظيم المناسبات لهم")).toBeInTheDocument();
  });

  it("lists each customer with its Arabic type label and contact details", () => {
    state.rows = [
      row({ id: "cu-1", name: "مريم بنت سعيد", phone: "+96891112222", customer_type: "INDIVIDUAL" }),
      row({
        id: "cu-2",
        name: "شركة الفجر",
        phone: null,
        whatsapp: "+96892223333",
        customer_type: "COMPANY",
      }),
    ];
    renderPage();

    expect(screen.getByRole("link", { name: "مريم بنت سعيد" })).toHaveAttribute(
      "href",
      "/customers/$customerId",
    );
    expect(screen.getByText("شركة الفجر")).toBeInTheDocument();
    expect(screen.getByText("فرد")).toBeInTheDocument();
    expect(screen.getByText("شركة")).toBeInTheDocument();
    expect(screen.getByText("+96891112222")).toBeInTheDocument();
    expect(screen.getByText("+96892223333")).toBeInTheDocument();
  });

  it("hides the create/edit controls from a read-only role", () => {
    state.canWrite = false;
    state.rows = [row()];
    renderPage();

    expect(screen.queryByRole("button", { name: /عميل جديد/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تعديل" })).not.toBeInTheDocument();
    expect(screen.getByText("مريم بنت سعيد")).toBeInTheDocument();
  });
});

describe("CustomersPage — create dialog", () => {
  it("requires a name before saving", async () => {
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /عميل جديد/ })[0]!);

    await userEvent.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("الاسم مطلوب")).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("saves a new customer and confirms with the customer name", async () => {
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /عميل جديد/ })[0]!);

    await userEvent.type(screen.getByLabelText(/الاسم/), "سالم الهنائي");
    await userEvent.type(screen.getByLabelText(/رقم الهاتف/), "+96893334444");
    await userEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(saveMutate).toHaveBeenCalledWith({
      id: null,
      values: expect.objectContaining({ name: "سالم الهنائي", phone: "+96893334444" }),
    });
    expect(toastSuccess).toHaveBeenCalledWith('تمت إضافة العميل "سالم الهنائي" بنجاح.');
  });

  it("blocks a duplicate phone number instead of splitting the client in two (F10)", async () => {
    state.rows = [row({ id: "cu-9", name: "عميل قائم", phone: "+96891112222" })];
    renderPage();

    await userEvent.click(screen.getAllByRole("button", { name: /عميل جديد/ })[0]!);
    await userEvent.type(screen.getByLabelText(/الاسم/), "نسخة مكررة");
    await userEvent.type(screen.getByLabelText(/رقم الهاتف/), " +968 9111 2222 ");
    await userEvent.click(screen.getByRole("button", { name: "حفظ" }));

    expect(
      await screen.findByText(/يوجد عميل بنفس رقم الهاتف: عميل قائم/),
    ).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });
});

describe("CustomersPage — edit dialog", () => {
  it("prefills the form and saves the change against the existing id", async () => {
    state.rows = [row({ id: "cu-7", name: "خالد", phone: "+96895556666" })];
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "تعديل" }));
    expect(screen.getByText("تعديل عميل")).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/الاسم/);
    expect(nameInput).toHaveValue("خالد");

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "خالد بن سيف");
    await userEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(saveMutate).toHaveBeenCalledWith({
      id: "cu-7",
      values: expect.objectContaining({ name: "خالد بن سيف" }),
    });
    expect(toastSuccess).toHaveBeenCalledWith('تم حفظ تعديلات العميل "خالد بن سيف".');
  });

  it("does not apply the duplicate guard when editing the same customer", async () => {
    state.rows = [row({ id: "cu-7", name: "خالد", phone: "+96895556666" })];
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "تعديل" }));
    await userEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/يوجد عميل بنفس رقم الهاتف/)).not.toBeInTheDocument();
  });
});
