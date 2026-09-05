import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAuth } from "@/app/authContext";
import { Can, CanGate } from "./Can";

vi.mock("@/app/authContext", () => ({ useAuth: vi.fn() }));

function mockCapabilities(caps: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    hasCapability: (capability: string) => caps.includes(capability),
  } as ReturnType<typeof useAuth>);
}

describe("Can", () => {
  it("renders children when the member holds the capability", () => {
    mockCapabilities(["payment.record"]);
    render(
      <Can capability="payment.record">
        <button type="button">تسجيل دفعة</button>
      </Can>,
    );
    expect(screen.getByRole("button", { name: "تسجيل دفعة" })).toBeInTheDocument();
  });

  it("hides children when the member lacks the capability", () => {
    mockCapabilities([]);
    render(
      <Can capability="payment.record">
        <button type="button">تسجيل دفعة</button>
      </Can>,
    );
    expect(
      screen.queryByRole("button", { name: "تسجيل دفعة" }),
    ).not.toBeInTheDocument();
  });

  it("CanGate keeps the affordance visible but reports the allowed flag", () => {
    mockCapabilities([]);
    render(
      <CanGate capability="finance.manage">
        {(allowed) => (
          <button type="button" disabled={!allowed} title={allowed ? undefined : "تتطلب صلاحية مالية"}>
            تسوية
          </button>
        )}
      </CanGate>,
    );
    const button = screen.getByRole("button", { name: "تسوية" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "تتطلب صلاحية مالية");
  });

  it("CanGate enables the affordance when the capability is present", () => {
    mockCapabilities(["finance.manage"]);
    render(
      <CanGate capability="finance.manage">
        {(allowed) => (
          <button type="button" disabled={!allowed}>
            تسوية
          </button>
        )}
      </CanGate>,
    );
    expect(screen.getByRole("button", { name: "تسوية" })).toBeEnabled();
  });
});
