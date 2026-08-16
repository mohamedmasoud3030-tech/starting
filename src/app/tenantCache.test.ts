import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { identityKey, resetTenantCache } from "./tenantCache";

describe("identityKey", () => {
  it("distinguishes the same user in different organizations", () => {
    expect(identityKey("user-1", "org-a")).not.toBe(identityKey("user-1", "org-b"));
  });

  it("distinguishes different users in the same organization", () => {
    expect(identityKey("user-1", "org-a")).not.toBe(identityKey("user-2", "org-a"));
  });

  it("is stable for an unchanged identity", () => {
    expect(identityKey("user-1", "org-a")).toBe(identityKey("user-1", "org-a"));
  });

  it("collapses signed-out states to one anonymous key", () => {
    expect(identityKey(null, null)).toBe(identityKey(undefined, undefined));
  });

  it("separates signed-out from any signed-in identity", () => {
    expect(identityKey(null, null)).not.toBe(identityKey("user-1", "org-a"));
  });
});

describe("resetTenantCache", () => {
  it("drops cached rows so a previous tenant's data cannot be rendered", () => {
    const queryClient = new QueryClient();
    // Simulate data fetched while organization A was active.
    queryClient.setQueryData(["events", "org-a"], [{ id: "event-a" }]);
    queryClient.setQueryData(["event", "org-a", "event-a"], { id: "event-a" });
    expect(queryClient.getQueryData(["events", "org-a"])).toBeDefined();

    resetTenantCache(queryClient);

    // Nothing from organization A survives the identity change.
    expect(queryClient.getQueryData(["events", "org-a"])).toBeUndefined();
    expect(queryClient.getQueryData(["event", "org-a", "event-a"])).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
