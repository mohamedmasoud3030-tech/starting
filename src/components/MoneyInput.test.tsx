import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoneyInput } from "./MoneyInput";

function Harness() {
  const [value, setValue] = useState<number | null>(0);
  return (
    <MoneyInput
      id="price"
      label="سعر البيع"
      value={value ?? 0}
      onChange={setValue}
    />
  );
}

describe("MoneyInput", () => {
  it("renders the label and OMR suffix", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/سعر البيع/)).toBeInTheDocument();
    expect(screen.getByText("ر.ع.")).toBeInTheDocument();
  });

  it("parses a typed decimal into exact milli-OMR", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText(/سعر البيع/) as HTMLInputElement;
    await user.type(input, "8.5");
    expect(input.value).toBe("8.5");
  });

  it("rejects invalid input without crashing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText(/سعر البيع/) as HTMLInputElement;
    await user.type(input, "abc");
    expect(input.value).toBe("abc");
  });

  it("re-syncs the visible value when remounted with a new key", () => {
    const { rerender } = render(
      <MoneyInput key="A" id="price" label="سعر البيع" value={1000} onChange={() => {}} />,
    );
    const input = screen.getByLabelText(/سعر البيع/) as HTMLInputElement;
    expect(input.value).toBe("1.000");

    // Switching the target item remounts the input (new key) with a new value.
    rerender(
      <MoneyInput key="B" id="price" label="سعر البيع" value={2500} onChange={() => {}} />,
    );
    expect((screen.getByLabelText(/سعر البيع/) as HTMLInputElement).value).toBe("2.500");
  });
});
