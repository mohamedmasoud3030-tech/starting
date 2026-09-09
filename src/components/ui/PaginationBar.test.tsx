import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaginationBar } from "./PaginationBar";

function renderBar(overrides: Partial<Parameters<typeof PaginationBar>[0]> = {}) {
  const props = {
    page: 0,
    pageSize: 50,
    totalPages: 3,
    hasPreviousPage: false,
    hasNextPage: true,
    isFetching: false,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    rowsCount: 50,
    total: 120,
    ...overrides,
  };
  render(<PaginationBar {...props} />);
  return props;
}

describe("PaginationBar (D21)", () => {
  it("hides itself until the exact total proves multiple pages", () => {
    const { container } = render(
      <PaginationBar
        page={0}
        pageSize={50}
        totalPages={null}
        hasPreviousPage={false}
        hasNextPage={false}
        isFetching={false}
        onPrevious={() => {}}
        onNext={() => {}}
        rowsCount={0}
        total={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the Arabic page counter and row window", () => {
    renderBar();
    expect(screen.getByText("صفحة 1 من 3")).toBeInTheDocument();
    expect(screen.getByText("عرض 1–50 من 120")).toBeInTheDocument();
  });

  it("wires السابق and التالي and disables impossible directions", async () => {
    const props = renderBar();
    const previous = screen.getByRole("button", { name: "السابق" });
    const next = screen.getByRole("button", { name: "التالي" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    await userEvent.click(next);
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onPrevious).not.toHaveBeenCalled();
  });

  it("disables both directions while a page fetch is in flight", () => {
    renderBar({ isFetching: true, hasPreviousPage: true });
    expect(screen.getByRole("button", { name: "السابق" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
  });
});
