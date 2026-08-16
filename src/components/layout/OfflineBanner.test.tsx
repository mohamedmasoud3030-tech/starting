import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { OfflineBanner } from "./OfflineBanner";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  setOnline(true);
});

describe("OfflineBanner", () => {
  it("stays out of the way while the device is online", () => {
    setOnline(true);
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("warns that shown data may be stale and that saving is unavailable", () => {
    setOnline(false);
    render(<OfflineBanner />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("لا يوجد اتصال بالإنترنت");
    expect(status).toHaveTextContent("قد لا تكون محدثة");
  });

  it("reacts to connectivity changes without a reload", () => {
    setOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
