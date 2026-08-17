import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventsPage } from "./EventsPage";

const state = vi.hoisted(() => ({
  customers: [] as Array<{ id: string; name: string; is_active: boolean }>,
}));

const createMutate = vi.fn();

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    currentOrganization: { id: "org-1", name: "دار الضيافة" },
    canWriteCustomers: true,
  }),
}));

vi.mock("@/lib/useStableIdempotencyKey", () => ({
  useStableIdempotencyKey: () => "key-session-1",
}));

vi.mock("@/features/ownerVoice/OwnerVoiceButton", () => ({
  OwnerVoiceButton: () => null,
}));

vi.mock("@/features/ownerVoice/screenSummary", () => ({
  buildEventsListVoiceSummary: () => null,
  EVENT_STATUS_ARABIC: {},
  DEFAULT_TIME_ZONE: "Asia/Muscat",
  toArabicDigits: (x: string | number) => String(x),
}));

vi.mock("./events.api", () => ({
  useEventsPage: () => ({
    data: { rows: [], total: 0 },
    isLoading: false,
    isSuccess: true,
    hasMore: false,
    loadMore: () => {},
    isFetching: false,
  }),
  useCreateEvent: () => ({ mutateAsync: createMutate, isPending: false }),
  arabicError: (cause: unknown) =>
    cause instanceof Error ? cause.message : String(cause),
}));

vi.mock("@/features/customers/customers.api", () => ({
  useCustomers: () => ({
    data: { rows: state.customers, total: state.customers.length },
    isLoading: false,
    isSuccess: true,
  }),
  useCustomersPage: () => ({
    data: { rows: state.customers, total: state.customers.length },
    isLoading: false,
    isSuccess: true,
    hasMore: false,
    loadMore: () => {},
    isFetching: false,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

describe("EventsPage — first-use journey (no customers yet)", () => {
  it("guides the owner to create a customer before the first event", async () => {
    state.customers = [];
    render(<EventsPage />);

    await userEvent.click(screen.getAllByRole("button", { name: /مناسبة جديدة/ })[0]!);

    expect(
      screen.getByText(/أنشئ العميل الأول ثم عدّ لإنشاء المناسبة/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "الانتقال إلى العملاء" }),
    ).toHaveAttribute("href", "/customers");
    expect(
      screen.getByRole("button", { name: "إنشاء المناسبة" }),
    ).toBeDisabled();
  });

  it("offers the customer select once a customer exists", async () => {
    state.customers = [{ id: "cu-1", name: "مريم", is_active: true }];
    render(<EventsPage />);

    await userEvent.click(screen.getAllByRole("button", { name: /مناسبة جديدة/ })[0]!);

    expect(
      screen.queryByText(/أنشئ العميل الأول/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /العميل/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "إنشاء المناسبة" }),
    ).toBeEnabled();
  });

  it("does not submit without a customer even if the guard is bypassed", async () => {
    state.customers = [];
    render(<EventsPage />);

    await userEvent.click(screen.getAllByRole("button", { name: /مناسبة جديدة/ })[0]!);
    expect(createMutate).not.toHaveBeenCalled();
  });
});
