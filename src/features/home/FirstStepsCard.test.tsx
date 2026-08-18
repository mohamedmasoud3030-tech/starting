import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FirstStepsCard } from "./FirstStepsCard";

// The card only needs Link's `to` prop; render it as a plain anchor.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
  }: {
    to: string;
    children: React.ReactNode;
  }) => <a href={to}>{children}</a>,
}));

describe("FirstStepsCard", () => {
  it("gives a new owner an ordered starting path, not a wall of zeros", () => {
    render(<FirstStepsCard />);

    expect(screen.getByText("ابدأ من هنا")).toBeInTheDocument();

    const steps = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(steps[0]).toContain("جهّز دليل الخدمات والأسعار");
    expect(steps[1]).toContain("أضف أول عميل");
    expect(steps[2]).toContain("أنشئ عرض سعر");
    expect(steps[3]).toContain("حوّل العرض إلى مناسبة");

    // The dependency chain is expressed as links to the real screens.
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/catalog",
      "/customers",
      "/quotes",
      "/events",
    ]);
  });
});
