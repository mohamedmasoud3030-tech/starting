import { describe, expect, it } from "vitest";
import { readinessLabel, readinessTone } from "./readiness.model";

describe("readinessLabel", () => {
  it("labels every readiness status the RPC can return", () => {
    expect(readinessLabel("READY")).toBe("جاهزة");
    expect(readinessLabel("STAFF_MISSING")).toBe("نقص في الفريق");
    expect(readinessLabel("EQUIPMENT_SHORTAGE")).toBe("نقص معدات");
    expect(readinessLabel("MULTIPLE_ISSUES")).toBe("تحتاج تدخل");
  });

  it("never presents unknown readiness as ready", () => {
    for (const status of [undefined, null, "", "SOMETHING_NEW"]) {
      expect(readinessLabel(status)).toBe("الجاهزية غير متاحة");
    }
  });
});

describe("readinessTone", () => {
  it("maps severity so multiple issues outrank a single shortage", () => {
    expect(readinessTone("READY")).toBe("success");
    expect(readinessTone("STAFF_MISSING")).toBe("warning");
    expect(readinessTone("EQUIPMENT_SHORTAGE")).toBe("warning");
    expect(readinessTone("MULTIPLE_ISSUES")).toBe("danger");
  });

  it("never renders unknown readiness with the success tone", () => {
    for (const status of [undefined, null, "SOMETHING_NEW"]) {
      expect(readinessTone(status)).not.toBe("success");
      expect(readinessTone(status)).toBe("neutral");
    }
  });
});
