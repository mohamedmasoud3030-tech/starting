import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FirstStepsCard } from "./FirstStepsCard";

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
  it("starts from a custom quote, not the catalog", () => {
    render(<FirstStepsCard />);

    expect(screen.getByText("ابدأ من هنا")).toBeInTheDocument();
    expect(screen.getByText(/عرض سعر ← اعتماد ← مناسبة/)).toBeInTheDocument();

    const steps = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(steps[0]).toContain("أنشئ عرض سعر");
    expect(steps[1]).toContain("أصدره وأعطه للعميل");
    expect(steps[2]).toContain("اعتمد ثم حوّل إلى مناسبة");
    expect(steps[3]).toContain("نفّذ، حصّل، ثم أغلق لتعرف الربح");

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/quotes/new",
      "/quotes",
      "/quotes",
      "/events",
    ]);
    expect(screen.queryByText(/جهّز دليل الخدمات/)).not.toBeInTheDocument();
  });
});
