import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("emits a UTF-8 BOM and Arabic headers", () => {
    const csv = toCsv(["الاسم", "المبلغ"], [["سعيد", "12.345"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("الاسم,المبلغ");
    expect(csv).toContain("سعيد,12.345");
  });

  it("quotes commas and doubles internal quotes", () => {
    const csv = toCsv(["ملاحظات"], [['قال "مرحبا"، ثم غادر']]);
    expect(csv).toContain('"قال ""مرحبا""، ثم غادر"');
  });

  it("renders empty cells for null/undefined rather than the word null", () => {
    const csv = toCsv(["أ", "ب"], [[null, undefined]]);
    expect(csv).toContain("أ,ب");
    expect(csv).not.toContain("null");
    expect(csv).not.toContain("undefined");
  });
});
