import { describe, expect, it } from "vitest";
import { parseBaseGuestCount, validatePackage } from "./packageForm";
import type { PackageFormValues } from "./packages.api";

function baseValues(overrides: Partial<PackageFormValues> = {}): PackageFormValues {
  return {
    name: "ضيافة قهوة",
    nameEn: "",
    description: "",
    status: "ACTIVE",
    baseGuestCount: 100,
    lines: [{ catalogItemId: "item-1", quantity: 3000 }],
    ...overrides,
  };
}

describe("package validation", () => {
  it("accepts a valid package", () => {
    expect(validatePackage(baseValues())).toEqual({});
  });

  it("rejects an empty name", () => {
    expect(validatePackage(baseValues({ name: "" })).name).toBeDefined();
  });

  it("rejects a line with no catalog item", () => {
    const errors = validatePackage(
      baseValues({ lines: [{ catalogItemId: "", quantity: 1000 }] }),
    );
    expect(errors.lines).toBeDefined();
  });

  it("rejects a zero quantity", () => {
    const errors = validatePackage(
      baseValues({ lines: [{ catalogItemId: "item-1", quantity: 0 }] }),
    );
    expect(errors.lines).toBe("الكمية يجب أن تكون أكبر من صفر");
  });

  it("rejects a negative quantity", () => {
    const errors = validatePackage(
      baseValues({ lines: [{ catalogItemId: "item-1", quantity: -1 }] }),
    );
    expect(errors.lines).toBeDefined();
  });

  it("rejects duplicate catalog items", () => {
    const errors = validatePackage(
      baseValues({
        lines: [
          { catalogItemId: "item-1", quantity: 1000 },
          { catalogItemId: "item-1", quantity: 2000 },
        ],
      }),
    );
    expect(errors.lines).toBe("لا يمكن تكرار نفس الصنف في الباقة الواحدة");
  });

  it("allows a package with no lines", () => {
    expect(validatePackage(baseValues({ lines: [] }))).toEqual({});
  });

  it("rejects a non-positive base guest count", () => {
    const errors = validatePackage(baseValues({ baseGuestCount: 0 }));
    expect(errors.baseGuestCount).toBeDefined();
  });
});

describe("parseBaseGuestCount", () => {
  it("returns null for empty input", () => {
    expect(parseBaseGuestCount("")).toEqual({ value: null });
  });

  it("parses a positive integer", () => {
    expect(parseBaseGuestCount("100")).toEqual({ value: 100 });
  });

  it("rejects malformed strings", () => {
    expect(parseBaseGuestCount("abc").error).toBeDefined();
    expect(parseBaseGuestCount("100abc").error).toBeDefined();
  });

  it("rejects zero and negatives", () => {
    expect(parseBaseGuestCount("0").error).toBeDefined();
    expect(parseBaseGuestCount("-5").error).toBeDefined();
  });
});
