import { describe, expect, it } from "vitest";
import { buildOperationsContext } from "./operations-context";
import type { AssistantContextPayload } from "./assistant-types";

const base = {
  orgId: "org-1",
  orgName: "ركن الضيافة",
  roleLabel: "المالك",
  capabilities: {
    canReadCost: true,
    canReadPayroll: true,
    canManageCommercial: true,
  },
  surface: "/home",
};

function rpcResponse(map: Record<string, unknown>) {
  return async (name: string): Promise<unknown> => map[name];
}

describe("buildOperationsContext", () => {
  it("collects metrics, alerts and today into a single payload", async () => {
    const payload = await buildOperationsContext({
      ...base,
      callRpc: rpcResponse({
        management_metrics: [
          { events_today: 3, collected: 1500, outstanding: 900 },
        ],
        management_alerts: [{ title: "مناسبة اليوم" }],
        today_collections: [{ event_id: "e1" }],
      }),
    });

    expect(payload.orgId).toBe("org-1");
    expect(payload.orgName).toBe("ركن الضيافة");
    expect(payload.metrics).toMatchObject({ events_today: 3 });
    expect(payload.alerts).toHaveLength(1);
    expect(payload.today).toMatchObject({ rows: [{ event_id: "e1" }] });
  });

  it("keeps optional sections null when an RPC is unavailable (fail-soft)", async () => {
    const payload = await buildOperationsContext({
      ...base,
      callRpc: rpcResponse({
        management_metrics: [{ events_today: 1 }],
        // management_alerts and today_collections intentionally absent
      }),
    });

    expect(payload.metrics).toMatchObject({ events_today: 1 });
    expect(payload.alerts).toBeNull();
    expect(payload.today).toBeNull();
  });

  it("does not throw when every RPC rejects — sections stay null", async () => {
    const payload = await buildOperationsContext({
      ...base,
      callRpc: async () => {
        throw new Error("RPC denied");
      },
    });

    const empty = payload satisfies AssistantContextPayload;
    expect(empty.metrics).toBeNull();
    expect(empty.alerts).toBeNull();
    expect(empty.today).toBeNull();
    expect(empty.capabilities.canReadCost).toBe(true);
  });
});
