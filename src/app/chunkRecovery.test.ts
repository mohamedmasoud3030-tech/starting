import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "./chunkRecovery";

describe("isChunkLoadError", () => {
  it("recognises stale-chunk failures from Vite/Chrome/Safari/Firefox", () => {
    expect(
      isChunkLoadError(
        new TypeError("Failed to fetch dynamically imported module: https://x/assets/A-1.js"),
      ),
    ).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
  });

  it("ignores ordinary runtime errors", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError("network down")).toBe(false);
  });
});
