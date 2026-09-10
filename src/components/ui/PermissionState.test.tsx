import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PermissionState } from "./PermissionState";

describe("PermissionState", () => {
  it("renders the required Arabic title", () => {
    render(<PermissionState title="المشتريات متاحة للصلاحيات المالية فقط." />);
    expect(
      screen.getByText("المشتريات متاحة للصلاحيات المالية فقط."),
    ).toBeInTheDocument();
  });

  it("renders the optional description when provided", () => {
    render(
      <PermissionState
        title="عروض الأسعار متاحة للمالك والمدير فقط."
        description="دورك الحالي لا يشمل هذه الصلاحية."
      />,
    );
    expect(screen.getByText("دورك الحالي لا يشمل هذه الصلاحية.")).toBeInTheDocument();
  });

  it("is presentational only (no role/security semantics)", () => {
    const { container } = render(<PermissionState title="لا يمكنك الوصول هنا." />);
    // It is a plain informational block — not a button/link/role widget.
    expect(container.querySelector("button, a, [role]")).toBeNull();
  });
});
