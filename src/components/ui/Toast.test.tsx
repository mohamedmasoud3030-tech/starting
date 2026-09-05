import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "./Toast";
import { useToast } from "./toastContext";

function Probe({ tone }: { tone: "success" | "error" | "info" }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast[tone]("رسالة تجريبية")}>
      أظهر
    </button>
  );
}

describe("Toast", () => {
  it("shows a success toast as an accessible polite status and dismisses on close", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Probe tone="success" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "أظهر" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("رسالة تجريبية");

    await user.click(screen.getByRole("button", { name: "إغلاق التنبيه" }));
    await waitFor(() =>
      expect(screen.queryByText("رسالة تجريبية")).not.toBeInTheDocument(),
    );
  });

  it("renders error toasts with the assertive alert role", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Probe tone="error" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "أظهر" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("رسالة تجريبية");
  });

  it("useToast fails soft (no-op) outside the provider", () => {
    render(<Probe tone="success" />);
    // Clicking must not throw even though no provider is mounted.
    expect(() =>
      screen.getByRole("button", { name: "أظهر" }).click(),
    ).not.toThrow();
  });
});
