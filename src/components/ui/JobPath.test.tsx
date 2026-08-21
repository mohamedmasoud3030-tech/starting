import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobPath } from "./JobPath";

describe("JobPath", () => {
  it("marks the current step and keeps the quote-to-profit order", () => {
    render(<JobPath current="run" />);
    const list = screen.getByRole("list", {
      name: "مسار العمل من عرض السعر حتى الربح",
    });
    expect(list).toBeInTheDocument();
    expect(screen.getByText("التنفيذ")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("عرض السعر")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("الربح")).toBeInTheDocument();
  });
});
