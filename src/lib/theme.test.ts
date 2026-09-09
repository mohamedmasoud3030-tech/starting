import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, resolveTheme, storedTheme, systemTheme } from "./theme";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("applyTheme adds/removes the dark class and stores the preference", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem("jiwdah-theme")).toBe("dark");

    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("jiwdah-theme")).toBe("light");
  });

  it("resolveTheme falls back to the system scheme when nothing is stored", () => {
    expect(storedTheme()).toBeNull();
    // jsdom has no matchMedia → the system scheme resolves to light.
    expect(systemTheme()).toBe("light");
    expect(resolveTheme()).toBe("light");
  });

  it("follows a dark OS preference while nothing is stored", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
    expect(systemTheme()).toBe("dark");
    expect(resolveTheme()).toBe("dark");
  });
});
