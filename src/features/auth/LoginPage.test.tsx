import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/app/AuthContext";
import { LoginPage } from "./LoginPage";

// LoginPage only needs `useNavigate`; stub it to avoid mounting a full router.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
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
});
