import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./SegmentedControl";

const OPTIONS = [
  { value: "today", label: "اليوم" },
  { value: "week", label: "الأسبوع" },
  { value: "month", label: "الشهر" },
] as const;

describe("SegmentedControl", () => {
  it("marks the active option with aria-pressed and the others as not pressed", () => {
    render(
      <SegmentedControl
        ariaLabel="فترة التقرير"
        value="week"
        onChange={() => {}}
        options={OPTIONS}
      />,
    );
    expect(screen.getByRole("group", { name: "فترة التقرير" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "الأسبوع" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "اليوم" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls onChange with the selected value when an option is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="فترة العرض"
        value="today"
        onChange={onChange}
        options={OPTIONS}
      />,
    );
    await user.click(screen.getByRole("button", { name: "الشهر" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("month");
  });

  it("is keyboard operable", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="فترة"
        value="today"
        onChange={onChange}
        options={OPTIONS}
      />,
    );
    const first = screen.getByRole("button", { name: "اليوم" });
    first.focus();
    await user.keyboard("{Enter}");
    // Enter on a button triggers a click; value is already "today" but the
    // handler must still be invoked (control is fully interactive).
    expect(onChange).toHaveBeenCalledWith("today");
  });
});
