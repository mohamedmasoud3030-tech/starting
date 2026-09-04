import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useAuth } from "@/app/authContext";
import { AppShell } from "./AppShell";

vi.mock("@/app/authContext", () => ({ useAuth: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select?: (s: unknown) => unknown }) =>
    select
      ? select({ location: { pathname: "/home" } })
      : { location: { pathname: "/home" } },
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const logout = vi.fn();
const switchOrganization = vi.fn();

function mockAuth() {
  vi.mocked(useAuth).mockReturnValue({
    memberships: [
      {
        membership: { role: "OWNER" },
        organization: { id: "org-a", name: "دار الضيافة العصرية", display_name: null },
      },
    ],
    currentOrganization: {
      id: "org-a",
      name: "دار الضيافة العصرية",
      display_name: null,
    },
    switchOrganization,
    canManageCommercial: true,
    canIssueQuotation: true,
    canReadCost: true,
    canReadPayroll: true,
    logout,
  } as never);
}

describe("AppShell", () => {
  beforeEach(() => {
    logout.mockClear();
    switchOrganization.mockClear();
  });

  it("renders the page content inside the shell", () => {
    mockAuth();
    render(
      <AppShell>
        <p>محتوى الصفحة</p>
      </AppShell>,
    );
    expect(screen.getByText("محتوى الصفحة")).toBeInTheDocument();
  });

  it("offers a skip link to the main content", () => {
    mockAuth();
    render(
      <AppShell>
        <p>محتوى الصفحة</p>
      </AppShell>,
    );

    const skip = screen.getByRole("link", { name: "تجاوز إلى المحتوى" });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(document.getElementById("main-content")).toBeInTheDocument();
  });

  it("exposes a header logout button that ends the session", async () => {
    mockAuth();
    render(
      <AppShell>
        <p>محتوى الصفحة</p>
      </AppShell>,
    );

    await userEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));
    expect(logout).toHaveBeenCalledOnce();
  });

  it("exposes logout inside the mobile navigation drawer", async () => {
    mockAuth();
    render(
      <AppShell>
        <p>محتوى الصفحة</p>
      </AppShell>,
    );

    await userEvent.click(screen.getByRole("button", { name: "المزيد" }));
    const drawer = screen.getByRole("navigation", { name: "التنقل على الجوال" });
    await userEvent.click(
      within(drawer).getByRole("button", { name: "تسجيل الخروج" }),
    );

    expect(logout).toHaveBeenCalledOnce();
  });
});
