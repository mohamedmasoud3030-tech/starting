import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("is hidden from assistive technology (purely decorative)", () => {
    const { container } = render(<Skeleton className="h-4 w-24" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("merges extra sizing classes while keeping the base shimmer", () => {
    const { container } = render(<Skeleton className="h-10 w-1/2" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass("h-10", "w-1/2");
    expect(el.className).toContain("animate-pulse");
  });
});
