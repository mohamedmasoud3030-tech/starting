import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnboardingPage } from "./OnboardingPage";

const createOrganization = vi.fn();
const logout = vi.fn();

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    user: { email: "owner@test.local" },
    createOrganization,
    logout,
  }),
}));

describe("OnboardingPage (first-login organization creation)", () => {
  it("creates the organization with the entered name", async () => {
    createOrganization.mockResolvedValue(undefined);
    render(<OnboardingPage />);

    await userEvent.type(screen.getByLabelText(/اسم المنشأة/), "مؤسسة الريان");
    await userEvent.click(screen.getByRole("button", { name: "إنشاء منشأتي" }));

    expect(createOrganization).toHaveBeenCalledWith("مؤسسة الريان");
  });

  it("surfaces the provider error message", async () => {
    createOrganization.mockRejectedValue(new Error("تعذّر إنشاء المنشأة"));
    render(<OnboardingPage />);

    await userEvent.type(screen.getByLabelText(/اسم المنشأة/), "مؤسسة");
    await userEvent.click(screen.getByRole("button", { name: "إنشاء منشأتي" }));

    expect(await screen.findByText("تعذّر إنشاء المنشأة")).toBeInTheDocument();
  });

  it("offers logout for a stuck account", async () => {
    render(<OnboardingPage />);
    await userEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));
    expect(logout).toHaveBeenCalledOnce();
  });
});
