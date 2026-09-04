import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppRole } from "@/lib/dbTypes";
import { SettingsPage } from "./SettingsPage";

const authState: { role: AppRole } = { role: "OWNER" };

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    currentOrganization: { id: "org-1", name: "مشاريع جودة الإنطلاقة" },
    currentRole: authState.role,
    // Mirrors the server role presets: only OWNER holds settings.manage.
    hasCapability: (capability: string) =>
      capability === "settings.manage" && authState.role === "OWNER",
    capabilities: new Set<string>(
      authState.role === "OWNER" ? ["settings.manage"] : [],
    ),
  }),
}));

// TeamPanel renders inside SettingsPage; keep its team queries hermetic.
vi.mock("@/features/settings/team.api", () => ({
  useOrgMembers: () => ({ data: [], isLoading: false }),
  useOrgInvitations: () => ({ data: [], isLoading: false }),
  useMemberCapabilities: () => ({ data: [] }),
  useSetMemberPermission: () => ({
    mutateAsync: async () => ({}),
    isPending: false,
  }),
  useClearMemberPermission: () => ({
    mutateAsync: async () => ({}),
    isPending: false,
  }),
  useCreateOrgInvitation: () => ({
    mutateAsync: async () => ({}),
    isPending: false,
  }),
  useRevokeOrgInvitation: () => ({
    mutateAsync: async () => ({}),
    isPending: false,
  }),
}));

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const c = {
        select: () => c,
        eq: () => c,
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === "organization_settings"
                ? {
                    organization_id: "org-1",
                    name_en: "Masharie Jiwdat Alantalaqah",
                    phone_primary: "98203088",
                    commercial_registration: "1466316",
                    quotation_number_prefix: "QT",
                    invoice_number_prefix: "INV",
                    event_number_prefix: "EV",
                  }
                : null,
            error: null,
          }),
      };
      return c;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  authState.role = "OWNER";
  rpcCalls.length = 0;
});

describe("SettingsPage", () => {
  it("shows the tenant name read-only and loads the stored settings", async () => {
    render(<SettingsPage />, { wrapper });
    expect(await screen.findByDisplayValue("Masharie Jiwdat Alantalaqah")).toBeInTheDocument();
    expect(screen.getByDisplayValue("98203088")).toBeInTheDocument();
  });

  it("saves the settings through the OWNER-only command", async () => {
    render(<SettingsPage />, { wrapper });
    const input = await screen.findByDisplayValue("Masharie Jiwdat Alantalaqah");
    await userEvent.clear(input);
    await userEvent.type(input, "New Co");
    await userEvent.click(screen.getByRole("button", { name: /حفظ الإعدادات/ }));
    await waitFor(() => expect(rpcCalls.length).toBeGreaterThan(0));
    const call = rpcCalls[0];
    expect(call?.name).toBe("save_organization_settings");
    expect(call?.args).toMatchObject({
      p_org_id: "org-1",
      p_name_en: "New Co",
    });
  });

  it("is read-only for a non-owner role", async () => {
    authState.role = "MANAGER";
    render(<SettingsPage />, { wrapper });
    expect(await screen.findByText(/للاطلاع فقط/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /حفظ الإعدادات/ })).not.toBeInTheDocument();
    const input = await screen.findByDisplayValue("Masharie Jiwdat Alantalaqah");
    expect(input).toBeDisabled();
  });
});
