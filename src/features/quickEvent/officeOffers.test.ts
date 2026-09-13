import { describe, expect, it } from "vitest";
import {
  OFFICE_OFFERS,
  buildOfferWhatsAppText,
  depositMilli,
  pickOfferForGuests,
} from "./officeOffers";

describe("office offers (printed price sheet)", () => {
  it("has the six tiers with the printed prices", () => {
    expect(OFFICE_OFFERS.map((o) => o.priceMilli / 1000)).toEqual([140, 230, 310, 400, 480, 550]);
  });

  it("picks the tier by guest count exactly like the sheet", () => {
    expect(pickOfferForGuests(20)?.tier).toBe(1);
    expect(pickOfferForGuests(120)?.tier).toBe(1);
    expect(pickOfferForGuests(121)?.tier).toBe(2);
    expect(pickOfferForGuests(250)?.tier).toBe(2);
    expect(pickOfferForGuests(350)?.tier).toBe(3);
    expect(pickOfferForGuests(600)?.tier).toBe(4);
    expect(pickOfferForGuests(750)?.tier).toBe(5);
    expect(pickOfferForGuests(1000)?.tier).toBe(6);
  });

  it("falls back to the edges outside the printed ranges", () => {
    expect(pickOfferForGuests(10)?.tier).toBe(1);
    expect(pickOfferForGuests(1500)?.tier).toBe(6);
    expect(pickOfferForGuests(0)).toBeNull();
    expect(pickOfferForGuests(Number.NaN)).toBeNull();
  });

  it("computes the 30% deposit in exact milli-OMR", () => {
    expect(depositMilli(310_000)).toBe(93_000);
    expect(depositMilli(140_000)).toBe(42_000);
  });

  it("builds a customer-facing WhatsApp text with no cost data", () => {
    const text = buildOfferWhatsAppText({
      customerName: "سالم",
      offer: OFFICE_OFFERS[2]!,
      guests: 350,
      dateLabel: "الخميس 5 مساءً",
      venue: "قاعة الفيحاء",
      eventNumber: "QT-2026-0001",
      orgName: "مشاريع جودة الانطلاقة",
    });
    expect(text).toContain("العرض الثالث");
    expect(text).toContain("310.000");
    expect(text).toContain("93.000");
    expect(text).toContain("QT-2026-0001");
    expect(text).not.toMatch(/تكلفة|هامش|ربح/);
  });
});

import { HOSPITALITY_INVENTORY, suggestedKit } from "./hospitalityInventory";

describe("hospitality inventory kit", () => {
  it("has unique item names across categories", () => {
    const names = HOSPITALITY_INVENTORY.flatMap((c) => c.items.map((i) => i.name));
    expect(new Set(names).size).toBe(names.length);
  });
  it("scales per-lane items and keeps per-event items fixed", () => {
    const one = suggestedKit(1);
    const three = suggestedKit(3);
    const pots1 = one.find((k) => k.name === "دلة قهوة عمانية")!.quantity;
    const pots3 = three.find((k) => k.name === "دلة قهوة عمانية")!.quantity;
    expect(pots3).toBe(pots1 * 3);
    const trolley1 = one.find((k) => k.name === "عربة نقل (ترولي)")!.quantity;
    const trolley3 = three.find((k) => k.name === "عربة نقل (ترولي)")!.quantity;
    expect(trolley3).toBe(trolley1);
  });
});
