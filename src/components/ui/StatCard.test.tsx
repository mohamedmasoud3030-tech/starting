import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard } from "./StatCard";

describe("StatCard", () => {
  it("renders an em dash — not a zero — when the value is not established", () => {
    render(<StatCard label="لم يُسجَّل حضورها" value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders a real settled zero as 0", () => {
    render(<StatCard label="تحتاج تدخل" value={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("renders a settled count", () => {
    render(<StatCard label="مناسبات اليوم" value={4} />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});
