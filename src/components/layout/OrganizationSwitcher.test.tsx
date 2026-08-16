import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuth } from "@/app/authContext";
import { OrganizationSwitcher } from "./OrganizationSwitcher";

vi.mock("@/app/authContext", () => ({ useAuth: vi.fn() }));

const switchOrganization = vi.fn();

function membership(id: string, name: string, role: string) {
  return {
    membership: { role },
    organization: { id, name, display_name: null },
  };
}

function mockAuth(memberships: unknown[], currentId: string | null) {
  vi.mocked(useAuth).mockReturnValue({
    memberships,
    currentOrganization: memberships
      .map((m) => (m as { organization: { id: string } }).organization)
      .find((o) => o.id === currentId) ?? null,
    switchOrganization,
  } as never);
}

describe("OrganizationSwitcher", () => {
  beforeEach(() => {
    switchOrganization.mockClear();
  });

  it("renders nothing for a user with a single organization", () => {
    mockAuth([membership("org-a", "دار الضيافة العصرية", "OWNER")], "org-a");
    const { container } = render(<OrganizationSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every organization with the role held INSIDE it", async () => {
    mockAuth(
      [
        membership("org-a", "دار الضيافة العصرية", "OWNER"),
        membership("org-b", "شركة صحار للفعاليات", "SUPERVISOR"),
      ],
      "org-a",
    );
    render(<OrganizationSwitcher />);

    await userEvent.click(screen.getByRole("button", { name: /دار الضيافة العصرية/ }));

    expect(screen.getByRole("menuitemradio", { name: /دار الضيافة العصرية/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const other = screen.getByRole("menuitemradio", { name: /شركة صحار للفعاليات/ });
    expect(other).toHaveAttribute("aria-checked", "false");
    // The role shown is the one held in THAT organization.
    expect(other).toHaveTextContent("المشرف");
  });

  it("switches to the chosen organization", async () => {
    mockAuth(
      [
        membership("org-a", "دار الضيافة العصرية", "OWNER"),
        membership("org-b", "شركة صحار للفعاليات", "SUPERVISOR"),
      ],
      "org-a",
    );
    render(<OrganizationSwitcher />);

    await userEvent.click(screen.getByRole("button", { name: /دار الضيافة العصرية/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /شركة صحار للفعاليات/ }));

    expect(switchOrganization).toHaveBeenCalledWith("org-b");
  });
});
