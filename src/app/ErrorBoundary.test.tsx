import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb(): never {
  throw new Error("render exploded");
}

describe("ErrorBoundary", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    consoleError.mockClear();
  });

  it("renders children when nothing fails", () => {
    render(
      <ErrorBoundary>
        <p>محتوى سليم</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("محتوى سليم")).toBeInTheDocument();
  });

  it("shows an Arabic recovery state instead of a blank screen", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("حدث خطأ غير متوقع في الشاشة")).toBeInTheDocument();
    // No technical detail leaks to the owner.
    expect(screen.queryByText(/render exploded/)).not.toBeInTheDocument();
  });

  it("reloads the page from the recovery action", async () => {
    // jsdom's location.reload is non-configurable, so replace location with a
    // minimal stub instead of spying on the property.
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { reload },
    });

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole("button", { name: "إعادة تحميل الصفحة" }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
