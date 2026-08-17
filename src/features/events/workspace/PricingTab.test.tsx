import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PricingTab } from "./PricingTab";
import type { CommercialLine, EventRow, Quote } from "../events.api";

const run = vi.fn().mockResolvedValue(undefined);

function line(): CommercialLine {
  return {
    id: "line-1",
    description: "ضيافة قهوة",
    item_type: "SERVICE",
    unit: "ضيف",
    pricing_method: "PER_UNIT",
    quantity: "10",
    unit_selling_price: "2.500",
    expected_unit_cost: "1.100",
    total_selling: "25.000",
    total_expected_cost: "11.000",
    is_custom: false,
  };
}

const event = {
  id: "ev-1",
  accepted_quotation_id: null,
} as EventRow;
const noQuotes: Quote[] = [];

function renderTab() {
  return render(
    <PricingTab
      event={event}
      lines={[line()]}
      quotes={noQuotes}
      canCost={true}
      canCommercial={true}
      deps={{ packages: [], run }}
    />,
  );
}

describe("PricingTab line editing (D35)", () => {
  beforeEach(() => {
    run.mockClear();
  });
  it("edits a line through the dialog instead of window.prompt", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "تعديل" }));

    // Dialog opens prefilled with the line values.
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const quantity = screen.getByLabelText(/الكمية/);
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "12");

    await userEvent.click(screen.getByRole("button", { name: "حفظ التعديل" }));

    expect(run).toHaveBeenCalledWith(
      "save_event_commercial_line",
      expect.objectContaining({
        p_line_id: "line-1",
        p_quantity: "12",
        p_unit_selling_price: "2.500",
        p_expected_unit_cost: "1.100",
      }),
    );
  });

  it("rejects a non-positive quantity with a visible error", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "تعديل" }));
    const quantity = screen.getByLabelText(/الكمية/);
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "0");
    await userEvent.click(screen.getByRole("button", { name: "حفظ التعديل" }));

    expect(run).not.toHaveBeenCalled();
    expect(screen.getByText("الكمية يجب أن تكون أكبر من صفر")).toBeInTheDocument();
  });
});
