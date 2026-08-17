import { describe, expect, it } from "vitest";
import { LIST_PAGE_CAP, listIsTruncated } from "./listCap";

describe("listIsTruncated", () => {
  it("detects a full page with more rows on the server", () => {
    expect(listIsTruncated(LIST_PAGE_CAP, LIST_PAGE_CAP + 1)).toBe(true);
  });

  it("does not flag a full page that is exactly the total", () => {
    expect(listIsTruncated(LIST_PAGE_CAP, LIST_PAGE_CAP)).toBe(false);
  });

  it("does not flag a page below the cap", () => {
    expect(listIsTruncated(42, 999)).toBe(false);
    expect(listIsTruncated(LIST_PAGE_CAP - 1, 5000)).toBe(false);
  });

  it("does not flag an unknown total (count unavailable)", () => {
    expect(listIsTruncated(LIST_PAGE_CAP, null)).toBe(false);
    expect(listIsTruncated(LIST_PAGE_CAP, undefined)).toBe(false);
  });

  it("never flags an empty page", () => {
    expect(listIsTruncated(0, 2000)).toBe(false);
  });
});
