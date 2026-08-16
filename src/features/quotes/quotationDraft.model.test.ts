import { describe, expect, it } from "vitest";
import {
  buildPackageLines,
  createCustomLine,
  createLineKeyFactory,
  draftFingerprint,
  emptyForm,
  hydrateFormFromDraft,
  isoToLocalInput,
  toDraftValues,
} from "./quotationDraft.model";

describe("quotationDraft.model", () => {
  describe("form hydration", () => {
    it("round-trips an empty draft", () => {
      expect(emptyForm()).toEqual({
        prospectName: "",
        prospectPhone: "",
        prospectWhatsapp: "",
        prospectCompany: "",
        eventTitle: "",
        eventType: "",
        startAt: "",
        endAt: "",
        venueName: "",
        notes: "",
      });
    });

    it("hydrates form fields from a persisted draft", () => {
      const form = hydrateFormFromDraft({
        customer_name_snapshot: "مريم",
        customer_phone_snapshot: "91234567",
        prospect_whatsapp: null,
        prospect_company: "شركة النور",
        event_title_snapshot: "زفاف",
        event_type_snapshot: "WEDDING",
        start_at_snapshot: "2026-09-01T16:00:00Z",
        end_at_snapshot: null,
        venue_snapshot: "قاعة الريان",
        notes: "ملاحظة",
      });
      expect(form.prospectName).toBe("مريم");
      expect(form.prospectPhone).toBe("91234567");
      expect(form.prospectWhatsapp).toBe("");
      expect(form.prospectCompany).toBe("شركة النور");
      expect(form.startAt).toMatch(/^2026-09-01T/);
      expect(form.endAt).toBe("");
      expect(form.venueName).toBe("قاعة الريان");
      expect(form.notes).toBe("ملاحظة");
    });

    it("isoToLocalInput returns empty for null/NaN", () => {
      expect(isoToLocalInput(null)).toBe("");
      expect(isoToLocalInput(undefined)).toBe("");
      expect(isoToLocalInput("not-a-date")).toBe("");
    });
  });

  describe("package expansion (exact money)", () => {
    const catalog = new Map([
      [
        "c1",
        {
          id: "c1",
          name: "قهوة",
          item_type: "SERVICE" as const,
          unit: "ضيف",
          pricing_method: "PER_GUEST" as const,
          selling_price: 2.8,
          cost_price: "1.250",
        },
      ],
    ]);

    it("normalizes numeric DB amounts through milli-OMR to 3-decimal text", () => {
      const nextKey = createLineKeyFactory();
      const lines = buildPackageLines(
        { lines: [{ catalog_item_id: "c1", quantity: 1 }] },
        catalog,
        "p1",
        nextKey,
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        clientKey: "line-1",
        id: null,
        description: "قهوة",
        itemType: "SERVICE",
        unit: "ضيف",
        pricingMethod: "PER_GUEST",
        quantity: "1.000",
        unitSellingPrice: "2.800",
        expectedUnitCost: "1.250",
        isCustom: false,
        sourceCatalogItemId: "c1",
        sourcePackageId: "p1",
      });
    });

    it("defaults missing cost price to zero", () => {
      const nextKey = createLineKeyFactory();
      const lines = buildPackageLines(
        { lines: [{ catalog_item_id: "c1", quantity: "2.5" }] },
        new Map([
          [
            "c1",
            {
              id: "c1",
              name: "خدمة",
              item_type: "SERVICE" as const,
              unit: "وحدة",
              pricing_method: "FIXED" as const,
              selling_price: "10.000",
              cost_price: null,
            },
          ],
        ]),
        "p1",
        nextKey,
      );
      expect(lines[0]!.quantity).toBe("2.500");
      expect(lines[0]!.unitSellingPrice).toBe("10.000");
      expect(lines[0]!.expectedUnitCost).toBe("0.000");
    });

    it("throws on missing catalog item (caller surfaces the Arabic error)", () => {
      const nextKey = createLineKeyFactory();
      expect(() =>
        buildPackageLines(
          { lines: [{ catalog_item_id: "missing", quantity: 1 }] },
          catalog,
          "p1",
          nextKey,
        ),
      ).toThrow("MISSING_CATALOG_ITEM");
    });
  });

  describe("custom line factory", () => {
    it("defaults unit and marks the line custom", () => {
      const line = createCustomLine("line-7", {
        description: "تصوير",
        quantity: "2",
        price: "50.000",
        itemType: "SERVICE",
        unit: "",
        pricingMethod: "FIXED",
      });
      expect(line).toMatchObject({
        clientKey: "line-7",
        id: null,
        unit: "وحدة",
        isCustom: true,
        expectedUnitCost: "0.000",
        sourceCatalogItemId: null,
        sourcePackageId: null,
      });
    });
  });

  describe("idempotency fingerprint", () => {
    const values = toDraftValues(emptyForm(), null);

    it("is stable for an identical payload", () => {
      const a = draftFingerprint({
        quotationId: null,
        values,
        lines: [],
      });
      const b = draftFingerprint({
        quotationId: null,
        values: toDraftValues(emptyForm(), null),
        lines: [],
      });
      expect(a).toBe(b);
    });

    it("changes when the payload changes", () => {
      const base = draftFingerprint({ quotationId: null, values, lines: [] });
      const withName = draftFingerprint({
        quotationId: null,
        values: toDraftValues({ ...emptyForm(), prospectName: "مريم" }, null),
        lines: [],
      });
      expect(withName).not.toBe(base);
    });

    it("changes when the saved draft id changes", () => {
      const base = draftFingerprint({ quotationId: null, values, lines: [] });
      const afterSave = draftFingerprint({ quotationId: "qt-1", values, lines: [] });
      expect(afterSave).not.toBe(base);
    });
  });
});
