import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const rpc = vi.fn();
const invoke = vi.fn();
const speak = vi.fn();
const stop = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
    functions: { invoke: (name: string, ...rest: unknown[]) => invoke(name, ...rest) },
  },
}));

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    currentOrganization: { id: "org-1", name: "ركن الضيافة" },
    currentRole: "OWNER",
    canReadCost: true,
    canReadPayroll: true,
    canManageCommercial: true,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => ({ location: { pathname: "/home" } }),
}));

vi.mock("./use-assistant-voice", () => ({
  useAssistantVoice: () => ({
    supported: true,
    speaking: false,
    speak,
    stop,
  }),
}));

import { AssistantLauncher } from "./AssistantLauncher";

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
  speak.mockReset();
  stop.mockReset();
  // Provide a minimal operations context + a valid assistant reply.
  rpc.mockResolvedValue([]);
  invoke.mockResolvedValue({
    data: {
      reply: "أتطلع إلى مناسبتين اليوم.",
      grounded: true,
      caveats: [],
      meta: { source: "model", degraded: false },
    },
    error: null,
  });
});

describe("AssistantLauncher", () => {
  it("renders a launcher button when signed in with an organization", () => {
    render(<AssistantLauncher />);
    expect(screen.getByRole("button", { name: /فتح مساعد/ })).toBeInTheDocument();
  });

  it("opens the panel and sends a prompt, then shows the reply", async () => {
    const user = userEvent.setup();
    render(<AssistantLauncher />);

    await user.click(screen.getByRole("button", { name: /فتح مساعد/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/الشريك التشغيلي/)).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "الرسالة" });
    await user.type(input, "ما أهم شيء اليوم؟");
    await user.click(screen.getByRole("button", { name: "إرسال" }));

    await waitFor(() => {
      expect(screen.getByText("أتطلع إلى مناسبتين اليوم.")).toBeInTheDocument();
    });
    expect(invoke).toHaveBeenCalledWith("ai-assistant", expect.anything());
  });

  it("reads the reply aloud only on an explicit speak action", async () => {
    const user = userEvent.setup();
    render(<AssistantLauncher />);

    await user.click(screen.getByRole("button", { name: /فتح مساعد/ }));
    const input = screen.getByRole("textbox", { name: "الرسالة" });
    await user.type(input, "ماذا ينتظرني؟");
    await user.click(screen.getByRole("button", { name: "إرسال" }));

    await waitFor(() => {
      expect(screen.getByText("أتطلع إلى مناسبتين اليوم.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "قراءة الرد" }));
    expect(speak).toHaveBeenCalledWith("أتطلع إلى مناسبتين اليوم.");
  });
});
