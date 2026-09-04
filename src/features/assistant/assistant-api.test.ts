import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (name: string, ...rest: unknown[]) => invoke(name, ...rest) },
  },
}));

import { requestAssistant } from "./assistant-api";
import type { AssistantRequest } from "./assistant-types";

beforeEach(() => {
  invoke.mockReset();
});

const request: AssistantRequest = {
  context: {
    orgId: "org-1",
    orgName: "ركن الضيافة",
    roleLabel: "المالك",
    capabilities: {
      canReadCost: true,
      canReadPayroll: true,
      canManageCommercial: true,
    },
    metrics: { events_today: 2 },
    alerts: null,
    today: null,
    surface: "/home",
  },
  history: [],
  prompt: "ما أهم ما أهتم به اليوم؟",
};

describe("requestAssistant", () => {
  it("invokes the edge function and normalizes a valid response", async () => {
    invoke.mockResolvedValue({
      data: {
        reply: "لا توجد متأخرات.",
        grounded: true,
        caveats: [],
        meta: { source: "model", degraded: false },
      },
      error: null,
    });

    const response = await requestAssistant(request);
    expect(invoke).toHaveBeenCalledWith("ai-assistant", { body: request });
    expect(response.reply).toBe("لا توجد متأخرات.");
    expect(response.grounded).toBe(true);
    expect(response.meta.source).toBe("model");
  });

  it("throws when the edge function reports an error", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "حد الاستخدام تجاوز" } });
    await expect(requestAssistant(request)).rejects.toThrow("حد الاستخدام تجاوز");
  });

  it("throws on a malformed payload (no reply string)", async () => {
    invoke.mockResolvedValue({ data: { grounded: true }, error: null });
    await expect(requestAssistant(request)).rejects.toThrow(/غير صالح/);
  });
});
