import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/app/AuthContext";
import { authLoginErrorMessage } from "./authErrors";
import { LoginPage } from "./LoginPage";

// LoginPage only needs `useNavigate` and `Link`; stub them to avoid mounting a full router.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

function renderLogin() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  it("shows the hospitality login, not a restaurant POS", () => {
    renderLogin();
    expect(screen.getByText("نظام إدارة الضيافة")).toBeInTheDocument();
  });

  it("shows a not-configured state and offers NO demo credentials", () => {
    renderLogin();
    // When Supabase is not configured there must be no demo login path.
    expect(
      screen.queryByText(/admin@|cashier@|kitchen@/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /المدير|الكاشير|المطبخ/ }),
    ).not.toBeInTheDocument();
  });

  it("explains what the product does and who it is for before login", () => {
    renderLogin();
    // A first-time visitor must learn the outcome promise and the audience.
    expect(
      screen.getByText(/حوّل طلب العميل إلى مناسبة/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/مكاتب خدمات الضيافة والمناسبات في سلطنة عُمان/),
    ).toBeInTheDocument();
  });

  it("offers self-serve signup and password recovery", () => {
    renderLogin();
    expect(
      screen.getByRole("link", { name: /أنشئ حساباً الآن/ }),
    ).toHaveAttribute("href", "/signup");
    expect(
      screen.getByRole("link", { name: /نسيت كلمة المرور/ }),
    ).toHaveAttribute("href", "/forgot-password");
  });
});

describe("authLoginErrorMessage", () => {
  it("explains wrong credentials in Arabic", () => {
    expect(authLoginErrorMessage(new Error("Invalid login credentials"))).toBe(
      "بيانات الدخول غير صحيحة. تحقق من البريد وكلمة المرور.",
    );
  });

  it("explains an unconfirmed email in Arabic", () => {
    expect(authLoginErrorMessage(new Error("Email not confirmed"))).toBe(
      "لم يتم تأكيد البريد الإلكتروني بعد. تحقق من بريدك أو تواصل مع المالك.",
    );
  });

  it("explains rate limiting in Arabic", () => {
    expect(authLoginErrorMessage(new Error("Too many requests"))).toBe(
      "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.",
    );
  });

  it("falls back to a generic Arabic message and never leaks raw text", () => {
    const message = authLoginErrorMessage(new Error("some internal failure"));
    expect(message).toBe("تعذّر تسجيل الدخول. تحقق من البيانات وأعد المحاولة.");
    expect(message).not.toContain("some internal failure");
  });
});
