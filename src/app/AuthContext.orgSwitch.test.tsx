/**
 * Integration-level regression test for organization (tenant) switching.
 *
 * Pins the full chain the unit tests only cover piecewise:
 *
 *   switchOrganization(orgId)
 *     → currentOrganization / currentRole recompute from the membership
 *       INSIDE the selected organization (never from another tenant's role)
 *     → the TanStack Query cache is CLEARED (not merely invalidated), so no
 *       previous tenant rows remain mounted or renderable
 *     → role-derived capabilities (canManageCommercial / canReadCost)
 *       recompute, which drives navigation/workspace visibility.
 *
 * One user, two independent organizations (المنشآت — tenants, never
 * branches/locations): OWNER in org-a, WAREHOUSE in org-b.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./AuthContext";
import { useAuth } from "./authContext";

const USER_ID = "user-1";

const memberships = [
  {
    organization_id: "org-a",
    user_id: USER_ID,
    role: "OWNER",
    status: "ACTIVE",
  },
  {
    organization_id: "org-b",
    user_id: USER_ID,
    role: "WAREHOUSE",
    status: "ACTIVE",
  },
];

const organizations = [
  { id: "org-a", name: "دار الضيافة العصرية", is_active: true },
  { id: "org-b", name: "شركة صحار للفعاليات", is_active: true },
];

/** Minimal awaitable PostgREST-builder stub for the tables AuthContext reads. */
function tableStub(table: string) {
  const rows =
    table === "organization_memberships"
      ? memberships
      : table === "organizations"
        ? organizations
        : [];
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    limit: () => builder,
    maybeSingle: () =>
      Promise.resolve({ data: table === "profiles" ? null : (rows[0] ?? null), error: null }),
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (
      resolve: (v: { data: unknown; error: null }) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: {
            session: {
              user: { id: "user-1" },
              access_token: "t",
            },
          },
        }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signOut: () => Promise.resolve({ error: null }),
    },
    from: (table: string) => tableStub(table),
  },
}));

vi.mock("./publicDemo", () => ({
  PUBLIC_DEMO_MODE: false,
  PUBLIC_DEMO_ORG_ID: "demo-org",
}));

function Probe() {
  const {
    currentOrganization,
    currentRole,
    canManageCommercial,
    canReadCost,
    switchOrganization,
    loading,
  } = useAuth();
  if (loading) return <p>loading</p>;
  return (
    <div>
      <p data-testid="org">{currentOrganization?.id ?? "none"}</p>
      <p data-testid="role">{currentRole ?? "none"}</p>
      <p data-testid="commercial">{String(canManageCommercial)}</p>
      <p data-testid="cost">{String(canReadCost)}</p>
      <button onClick={() => switchOrganization("org-b")}>switch</button>
    </div>
  );
}

let queryClient: QueryClient;

beforeEach(() => {
  localStorage.clear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

describe("organization switching (integration)", () => {
  it("recomputes role + capabilities and clears every cached tenant row", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    // Deterministic default: first org by Arabic name → org-a (OWNER).
    await waitFor(() =>
      expect(screen.getByTestId("org").textContent).toBe("org-a"),
    );
    expect(screen.getByTestId("role").textContent).toBe("OWNER");
    expect(screen.getByTestId("commercial").textContent).toBe("true");
    expect(screen.getByTestId("cost").textContent).toBe("true");

    // Simulate tenant-scoped rows fetched while org-a was active.
    queryClient.setQueryData(["events", "org-a"], [{ id: "event-a" }]);
    queryClient.setQueryData(
      ["event-finance", "org-a", "event-a"],
      { eventId: "event-a" },
    );

    await act(async () => {
      screen.getByRole("button", { name: "switch" }).click();
    });

    // Role and capabilities now come from the membership INSIDE org-b.
    await waitFor(() =>
      expect(screen.getByTestId("org").textContent).toBe("org-b"),
    );
    expect(screen.getByTestId("role").textContent).toBe("WAREHOUSE");
    expect(screen.getByTestId("commercial").textContent).toBe("false");
    expect(screen.getByTestId("cost").textContent).toBe("false");

    // No previous-tenant row survives the identity change.
    await waitFor(() => {
      expect(queryClient.getQueryData(["events", "org-a"])).toBeUndefined();
      expect(
        queryClient.getQueryData(["event-finance", "org-a", "event-a"]),
      ).toBeUndefined();
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    });

    // The selection is remembered for the next visit.
    expect(localStorage.getItem("hospitality.activeOrganizationId")).toBe(
      "org-b",
    );
  });
});
