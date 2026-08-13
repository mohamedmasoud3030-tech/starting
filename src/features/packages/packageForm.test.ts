import { describe, expect, it } from "vitest";
import { validatePackage } from "./packageForm";
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

  it("rejects a negative quantity", () => {
    const errors = validatePackage(
      baseValues({ lines: [{ catalogItemId: "item-1", quantity: -1 }] }),
    );
    expect(errors.lines).toBeDefined();
  });

  it("allows a package with no lines", () => {
    expect(validatePackage(baseValues({ lines: [] }))).toEqual({});
  });
});
