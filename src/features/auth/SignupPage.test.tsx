import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignupPage } from "./SignupPage";

const state = vi.hoisted(() => ({ session: null as unknown }));
const signUp = vi.fn();
const login = vi.fn();

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      signUp: (...args: unknown[]) => {
        state.session = signUp(...args);
        return state.session;
      },
    },
  },
}));

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({ login }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

describe("SignupPage", () => {
  it("rejects mismatched passwords before calling the server", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    render(<SignupPage />);

    await userEvent.type(screen.getByLabelText(/البريد الإلكتروني/), "a@b.co");
    await userEvent.type(screen.getByLabelText(/^كلمة المرور/), "password123");
    await userEvent.type(screen.getByLabelText(/تأكيد كلمة المرور/), "different1");
    await userEvent.click(screen.getByRole("button", { name: "إنشاء الحساب" }));

    expect(signUp).not.toHaveBeenCalled();
    expect(screen.getByText("كلمتا المرور غير متطابقتين")).toBeInTheDocument();
  });

  it("signs up and asks for email confirmation when no session returns", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    render(<SignupPage />);

    await userEvent.type(screen.getByLabelText(/البريد الإلكتروني/), "a@b.co");
    await userEvent.type(screen.getByLabelText(/^كلمة المرور/), "password123");
    await userEvent.type(screen.getByLabelText(/تأكيد كلمة المرور/), "password123");
    await userEvent.click(screen.getByRole("button", { name: "إنشاء الحساب" }));

    expect(await screen.findByText(/تحقق من بريدك الإلكتروني/)).toBeInTheDocument();
  });
});
