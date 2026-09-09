import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (name: string, ...rest: unknown[]) => invoke(name, ...rest) },
  },
}));

import { requestAssistant, synthesizeSpeech, transcribeVoice } from "./assistant-api";
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

function chatPayload() {
  return {
    action: "chat",
    context: request.context,
    history: request.history,
    prompt: request.prompt,
  };
}

describe("requestAssistant", () => {
  it("invokes the chat action and normalizes a valid response", async () => {
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
    expect(invoke).toHaveBeenCalledWith("ai-assistant", { body: chatPayload() });
    expect(response.reply).toBe("لا توجد متأخرات.");
    expect(response.grounded).toBe(true);
    expect(response.meta.source).toBe("model");
  });

  it("flags a degraded fallback reply from the meta", async () => {
    invoke.mockResolvedValue({
      data: {
        reply: "راجع لوحة المتابعة.",
        grounded: true,
        caveats: [],
        meta: { source: "deterministic", degraded: true },
      },
      error: null,
    });
    const response = await requestAssistant(request);
    expect(response.meta.degraded).toBe(true);
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

describe("transcribeVoice", () => {
  it("invokes the transcribe action and returns the transcript", async () => {
    invoke.mockResolvedValue({ data: { text: "هاتف المورد متأخر" }, error: null });
    const text = await transcribeVoice("QUJD", "audio/wav");
    expect(invoke).toHaveBeenCalledWith("ai-assistant", {
      body: { action: "transcribe", audioB64: "QUJD", mimeType: "audio/wav" },
    });
    expect(text).toBe("هاتف المورد متأخر");
  });

  it("throws when no transcript came back", async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await expect(transcribeVoice("QUJD", "audio/wav")).rejects.toThrow(/فهم التسجيل/);
  });
});

describe("synthesizeSpeech", () => {
  it("invokes the speak action and returns the audio clip", async () => {
    invoke.mockResolvedValue({ data: { audioB64: "V0FW", mimeType: "audio/wav" }, error: null });
    const clip = await synthesizeSpeech("مرحباً بك");
    expect(invoke).toHaveBeenCalledWith("ai-assistant", {
      body: { action: "speak", text: "مرحباً بك" },
    });
    expect(clip).toEqual({ kind: "ok", audioB64: "V0FW", mimeType: "audio/wav" });
  });

  it("marks the outcome as failed when the audio payload is missing", async () => {
    invoke.mockResolvedValue({ data: { mimeType: "audio/wav" }, error: null });
    await expect(synthesizeSpeech("مرحباً")).resolves.toEqual({ kind: "failed" });
  });

  it("marks the outcome as quota when the provider budget is spent", async () => {
    invoke.mockResolvedValue({
      data: { error: { code: "SPEAK_QUOTA", retryAfterSeconds: 3600 } },
      error: null,
    });
    await expect(synthesizeSpeech("مرحباً")).resolves.toEqual({ kind: "quota" });
  });

  it("marks a network failure as failed rather than throwing", async () => {
    invoke.mockRejectedValue(new Error("offline"));
    await expect(synthesizeSpeech("مرحباً")).resolves.toEqual({ kind: "failed" });
  });
});
