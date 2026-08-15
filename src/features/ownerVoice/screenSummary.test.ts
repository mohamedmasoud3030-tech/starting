import { describe, expect, it } from "vitest";
import {
  arabicCountPhrase,
  buildEventVoiceSummary,
  buildEventsListVoiceSummary,
  buildHomeVoiceSummary,
  buildPaymentsVoiceSummary,
  buildProcurementVoiceSummary,
  buildQuickQuoteVoiceSummary,
  buildQuoteVoiceSummary,
  isSameLocalDay,
  omrToSpoken,
  spokenDayPhrase,
  spokenEventNumber,
  spokenHourPhrase,
  toArabicDigits,
  type ArabicCountForms,
  type EventLike,
  type EventWithReadiness,
} from "./screenSummary";

const NOW = new Date("2026-08-14T12:00:00Z"); // 16:00 في مسقط
const TZ = "Asia/Muscat";

const READY = { status: "READY", staff_missing: 0, equipment_shortage: 0 };

function event(overrides: Partial<EventWithReadiness> = {}): EventWithReadiness {
  return {
    id: "1",
    event_number: "EV-2026-00125",
    title: "زفاف محمد",
    start_at: "2026-08-14T15:00:00Z", // 19:00 مسقط
    end_at: "2026-08-14T21:00:00Z",
    status: "CONFIRMED",
    venue_name: "قاعة الريان",
    guest_count: 120,
    ...overrides,
  };
}

describe("Arabic number helpers", () => {
  it("converts Latin digits to Arabic-Indic digits", () => {
    expect(toArabicDigits("125")).toBe("١٢٥");
    expect(toArabicDigits(2026)).toBe("٢٠٢٦");
    expect(toArabicDigits("EV-2026-00125")).toBe("EV-٢٠٢٦-٠٠١٢٥");
  });

  it("speaks only the meaningful event sequence number", () => {
    expect(spokenEventNumber("EV-2026-00125")).toBe("١٢٥");
    expect(spokenEventNumber("QT-2026-00042")).toBe("٤٢");
    expect(spokenEventNumber("2026")).toBe("٢٠٢٦");
  });

  it("handles practical Arabic pluralization", () => {
    const forms: ArabicCountForms = {
      one: "مناسبة واحدة",
      two: "مناسبتان",
      few: "مناسبات",
      many: "مناسبة",
    };
    expect(arabicCountPhrase(1, forms)).toBe("مناسبة واحدة");
    expect(arabicCountPhrase(2, forms)).toBe("مناسبتان");
    expect(arabicCountPhrase(3, forms)).toBe("٣ مناسبات");
    expect(arabicCountPhrase(10, forms)).toBe("١٠ مناسبات");
    expect(arabicCountPhrase(11, forms)).toBe("١١ مناسبة");
    expect(arabicCountPhrase(120, forms)).toBe("١٢٠ مناسبة");
  });

  it("formats times of day for speech", () => {
    expect(spokenHourPhrase(7, 0)).toBe("الساعة ٧ صباحاً");
    expect(spokenHourPhrase(19, 0)).toBe("الساعة ٧ مساءً");
    expect(spokenHourPhrase(13, 30)).toBe("الساعة ١ و ٣٠ دقيقة ظهراً");
    expect(spokenHourPhrase(0, 0)).toBe("الساعة ١٢ ليلاً");
  });

  it("formats day phrases relative to today in Muscat", () => {
    expect(spokenDayPhrase("2026-08-14T15:00:00Z", NOW, TZ)).toBe("اليوم");
    expect(spokenDayPhrase("2026-08-15T15:00:00Z", NOW, TZ)).toBe("غداً");
    expect(spokenDayPhrase("2026-08-16T15:00:00Z", NOW, TZ)).toBe("يوم الأحد");
    expect(spokenDayPhrase("2026-09-01T15:00:00Z", NOW, TZ)).toBe(
      "بتاريخ ١ سبتمبر",
    );
  });

  it("detects the same calendar day across the UTC boundary", () => {
    // 19:59Z = 23:59 مسقط في 14 أغسطس; 20:00Z = 00:00 في 15 أغسطس
    expect(isSameLocalDay("2026-08-14T19:59:00Z", NOW, TZ)).toBe(true);
    expect(isSameLocalDay("2026-08-14T20:00:00Z", NOW, TZ)).toBe(false);
  });

  it("formats OMR amounts for speech without computing money", () => {
    expect(omrToSpoken("850.000")).toBe("٨٥٠ ريال");
    expect(omrToSpoken("12.500")).toBe("١٢٫٥ ريال");
    expect(omrToSpoken("0.500")).toBe("٠٫٥ ريال");
    expect(omrToSpoken("-12.500")).toBe("سالب ١٢٫٥ ريال");
    expect(omrToSpoken(null)).toBeNull();
    expect(omrToSpoken("")).toBeNull();
    expect(omrToSpoken("n/a")).toBeNull();
  });
});

describe("buildHomeVoiceSummary", () => {
  it("produces the owner summary: today, ready count, one staff shortage", () => {
    const summary = buildHomeVoiceSummary({
      now: NOW,
      timeZone: TZ,
      events: [
        event({
          id: "a",
          venue_name: "قاعة المرسى",
          start_at: "2026-08-14T17:30:00Z",
          readiness: READY,
        }),
        event({
          id: "b",
          venue_name: "قاعة النخيل",
          start_at: "2026-08-14T14:00:00Z",
          readiness: READY,
        }),
        event({
          id: "c",
          venue_name: "قاعة الريان",
          readiness: {
            status: "STAFF_MISSING",
            staff_missing: 2,
            equipment_shortage: 0,
          },
        }),
      ],
    });
    expect(summary).toBe(
      "عندك اليوم ٣ مناسبات. مناسبتان جاهزتان. مناسبة قاعة الريان اليوم الساعة ٧ مساءً ناقصها شخصان من الفريق. لا توجد مشاكل أخرى تحتاج تدخل الآن.",
    );
  });

  it("says there is nothing today", () => {
    const summary = buildHomeVoiceSummary({
      now: NOW,
      timeZone: TZ,
      events: [event({ start_at: "2026-08-15T15:00:00Z", readiness: READY })],
    });
    expect(summary).toBe("لا توجد مناسبات اليوم.");
  });

  it("reports an equipment shortage", () => {
    const summary = buildHomeVoiceSummary({
      now: NOW,
      timeZone: TZ,
      events: [
        event({
          readiness: {
            status: "EQUIPMENT_SHORTAGE",
            staff_missing: 0,
            equipment_shortage: 3,
          },
        }),
      ],
    });
    expect(summary).toBe(
      "عندك اليوم مناسبة واحدة. مناسبة قاعة الريان اليوم الساعة ٧ مساءً ناقصها ٣ من المعدات. لا توجد مشاكل أخرى تحتاج تدخل الآن.",
    );
  });

  it("reports a fully ready day without inventing problems", () => {
    const summary = buildHomeVoiceSummary({
      now: NOW,
      timeZone: TZ,
      events: [event({ readiness: READY })],
    });
    expect(summary).toBe(
      "عندك اليوم مناسبة واحدة. مناسبة واحدة جاهزة. لا توجد مشاكل تحتاج تدخل الآن.",
    );
  });

  it("ignores cancelled events for today's attention list", () => {
    const summary = buildHomeVoiceSummary({
      now: NOW,
      timeZone: TZ,
      events: [
        event({ status: "CANCELLED", readiness: null }),
        event({ id: "x", venue_name: "قاعة النخيل", readiness: READY }),
      ],
    });
    expect(summary).toBe(
      "عندك اليوم مناسبة واحدة. مناسبة واحدة جاهزة. لا توجد مشاكل تحتاج تدخل الآن.",
    );
  });

  it("does not over-claim readiness while data is still loading", () => {
    const summary = buildHomeVoiceSummary({
      now: NOW,
      timeZone: TZ,
      events: [event({ readiness: undefined })],
    });
    expect(summary).toBe("عندك اليوم مناسبة واحدة.");
  });

  it("is deterministic across identical inputs", () => {
    const input = {
      now: NOW,
      timeZone: TZ,
      events: [
        event({ readiness: READY }),
        event({
          id: "c",
          venue_name: "قاعة المرسى",
          readiness: {
            status: "STAFF_MISSING",
            staff_missing: 4,
            equipment_shortage: 0,
          },
        }),
      ],
    };
    expect(buildHomeVoiceSummary(input)).toBe(
      buildHomeVoiceSummary({ ...input, now: new Date(NOW) }),
    );
  });
});

describe("buildEventsListVoiceSummary", () => {
  const listEvents: EventLike[] = [
    event({
      id: "e1",
      title: "زفاف قاعة الريان",
      start_at: "2026-08-15T14:00:00Z",
      status: "CONFIRMED",
    }),
    event({
      id: "e2",
      title: "مؤتمر النخيل",
      start_at: "2026-08-17T14:00:00Z",
      status: "CONFIRMED",
    }),
    event({
      id: "e3",
      title: "عشاء الشركة",
      start_at: "2026-08-16T14:00:00Z",
      status: "PREPARING",
    }),
    event({
      id: "e4",
      title: "مناسبة ملغاة",
      start_at: "2026-08-15T09:00:00Z",
      status: "CANCELLED",
    }),
    event({
      id: "e5",
      title: "اجتماع",
      start_at: "2026-08-14T10:00:00Z",
      status: "DRAFT",
    }),
  ];

  it("summarizes total, status highlights and the next event", () => {
    expect(
      buildEventsListVoiceSummary({ events: listEvents, now: NOW, timeZone: TZ }),
    ).toBe(
      "عندك ٥ مناسبات. منها مناسبتان مؤكدتان و مناسبة واحدة قيد التجهيز و مناسبة واحدة ملغاة. المناسبة القادمة زفاف قاعة الريان غداً الساعة ٦ مساءً.",
    );
  });

  it("handles an empty list", () => {
    expect(buildEventsListVoiceSummary({ events: [] })).toBe(
      "لا توجد مناسبات مسجلة.",
    );
  });

  it("notes when no event is upcoming", () => {
    expect(
      buildEventsListVoiceSummary({
        events: [
          event({ start_at: "2026-08-13T15:00:00Z", status: "CONFIRMED" }),
        ],
        now: NOW,
        timeZone: TZ,
      }),
    ).toBe("عندك مناسبة واحدة. منها مناسبة واحدة مؤكدة. لا توجد مناسبات قادمة.");
  });
});

describe("buildEventVoiceSummary", () => {
  const baseEvent: EventLike = {
    id: "1",
    event_number: "EV-2026-00125",
    title: "زفاف محمد",
    start_at: "2026-08-14T15:00:00Z",
    end_at: "2026-08-14T21:00:00Z",
    status: "CONFIRMED",
    venue_name: "قاعة الريان",
    guest_count: 120,
    customer_name: "محمد",
  };

  it("covers number, time, customer, venue, guests, status and readiness", () => {
    expect(
      buildEventVoiceSummary({
        event: baseEvent,
        readiness: READY,
        now: NOW,
        timeZone: TZ,
      }),
    ).toBe(
      "مناسبة رقم ١٢٥ اليوم الساعة ٧ مساءً. العميل محمد. الموقع قاعة الريان. عدد الضيوف ١٢٠. المناسبة مؤكدة. المناسبة جاهزة.",
    );
  });

  it("reports a staff shortage", () => {
    expect(
      buildEventVoiceSummary({
        event: baseEvent,
        readiness: {
          status: "STAFF_MISSING",
          staff_missing: 2,
          equipment_shortage: 0,
        },
        now: NOW,
        timeZone: TZ,
      }),
    ).toBe(
      "مناسبة رقم ١٢٥ اليوم الساعة ٧ مساءً. العميل محمد. الموقع قاعة الريان. عدد الضيوف ١٢٠. المناسبة مؤكدة. الفريق ناقص شخصين.",
    );
  });

  it("reports an equipment shortage", () => {
    expect(
      buildEventVoiceSummary({
        event: baseEvent,
        readiness: {
          status: "EQUIPMENT_SHORTAGE",
          staff_missing: 0,
          equipment_shortage: 3,
        },
        now: NOW,
        timeZone: TZ,
      }),
    ).toBe(
      "مناسبة رقم ١٢٥ اليوم الساعة ٧ مساءً. العميل محمد. الموقع قاعة الريان. عدد الضيوف ١٢٠. المناسبة مؤكدة. المعدات ناقصة ٣.",
    );
  });

  it("reports multiple issues in one short sentence", () => {
    expect(
      buildEventVoiceSummary({
        event: baseEvent,
        readiness: {
          status: "MULTIPLE_ISSUES",
          staff_missing: 1,
          equipment_shortage: 2,
        },
        now: NOW,
        timeZone: TZ,
      }),
    ).toBe(
      "مناسبة رقم ١٢٥ اليوم الساعة ٧ مساءً. العميل محمد. الموقع قاعة الريان. عدد الضيوف ١٢٠. المناسبة مؤكدة. الفريق ناقص شخص واحد والمعدات ناقصة ٢.",
    );
  });

  it("never narrates stale readiness for a cancelled event", () => {
    expect(
      buildEventVoiceSummary({
        event: { ...baseEvent, status: "CANCELLED" },
        readiness: {
          status: "STAFF_MISSING",
          staff_missing: 5,
          equipment_shortage: 0,
        },
        now: NOW,
        timeZone: TZ,
      }),
    ).toBe(
      "مناسبة رقم ١٢٥ اليوم الساعة ٧ مساءً. العميل محمد. الموقع قاعة الريان. عدد الضيوف ١٢٠. المناسبة ملغاة.",
    );
  });
});

describe("buildQuickQuoteVoiceSummary", () => {
  it("speaks total, guests and unaccepted status (mission example)", () => {
    expect(
      buildQuickQuoteVoiceSummary({
        totalSellingOmr: "850.000",
        guestCount: 120,
        status: "ISSUED",
      }),
    ).toBe("عرض السعر الإجمالي ٨٥٠ ريال. عدد الضيوف ١٢٠. العرض لم يتم اعتماده بعد.");
  });

  it("omits the guest sentence when the guest count is unknown", () => {
    expect(
      buildQuickQuoteVoiceSummary({
        totalSellingOmr: "850.000",
        guestCount: null,
        status: "ISSUED",
      }),
    ).toBe("عرض السعر الإجمالي ٨٥٠ ريال. العرض لم يتم اعتماده بعد.");
  });

  it("reflects accepted and converted status", () => {
    expect(
      buildQuickQuoteVoiceSummary({ totalSellingOmr: "850.000", guestCount: null, status: "ACCEPTED" }),
    ).toBe("عرض السعر الإجمالي ٨٥٠ ريال. العرض معتمد.");
    expect(
      buildQuickQuoteVoiceSummary({ totalSellingOmr: "850.000", guestCount: null, status: "CONVERTED" }),
    ).toBe("عرض السعر الإجمالي ٨٥٠ ريال. تم تحويل العرض إلى مناسبة.");
  });

  it("returns null (button hidden) when there is no total to speak", () => {
    expect(
      buildQuickQuoteVoiceSummary({ totalSellingOmr: null, guestCount: null, status: "ISSUED" }),
    ).toBeNull();
  });
});

describe("buildQuoteVoiceSummary", () => {
  it("speaks the agreement total plus cost/profit when authorized", () => {
    expect(
      buildQuoteVoiceSummary({
        totalSellingOmr: "850.000",
        expectedCostOmr: "300.000",
        expectedProfitOmr: "550.000",
        canReadCost: true,
        quotationNumber: "QT-2026-00042",
        quotationStatus: "ACCEPTED",
      }),
    ).toBe(
      "إجمالي الاتفاق ٨٥٠ ريال. عرض السعر رقم ٤٢ معتمد. التكلفة المتوقعة ٣٠٠ ريال. الربح المتوقع ٥٥٠ ريال.",
    );
  });

  it("never leaks cost or profit to roles without cost access", () => {
    const summary = buildQuoteVoiceSummary({
      totalSellingOmr: "850.000",
      expectedCostOmr: "300.000",
      expectedProfitOmr: "550.000",
      canReadCost: false,
    });
    expect(summary).toBe("إجمالي الاتفاق ٨٥٠ ريال.");
    expect(summary).not.toMatch(/التكلفة|الربح|٣٠٠|٥٥٠/);
  });

  it("speaks paid/remaining when payment data is provided (future S+ slot)", () => {
    expect(
      buildQuoteVoiceSummary({
        totalSellingOmr: "850.000",
        paidOmr: "300.000",
        remainingOmr: "550.000",
        canReadCost: false,
      }),
    ).toBe(
      "إجمالي الاتفاق ٨٥٠ ريال. المدفوع ٣٠٠ ريال. المتبقي ٥٥٠ ريال.",
    );
  });

  it("does not invent financial data", () => {
    expect(
      buildQuoteVoiceSummary({ totalSellingOmr: null, canReadCost: false }),
    ).toBe("لا توجد بيانات تسعير بعد.");
  });
});

describe("buildProcurementVoiceSummary", () => {
  it("summarizes suppliers, orders, open orders and committed cost when authorized", () => {
    expect(
      buildProcurementVoiceSummary({
        supplierCount: 3,
        orderCount: 5,
        openOrderCount: 2,
        totalCommittedOmr: "850.000",
        canReadCost: true,
      }),
    ).toBe(
      "عندك ٣ موردين. إجمالي الطلبات ٥ طلبات منها طلبان مفتوحان. إجمالي الالتزامات ٨٥٠ ريال.",
    );
  });

  it("never speaks committed cost when canReadCost is false", () => {
    const summary = buildProcurementVoiceSummary({
      supplierCount: 2,
      orderCount: 4,
      openOrderCount: 1,
      totalCommittedOmr: "850.000",
      canReadCost: false,
    });
    expect(summary).toBe(
      "عندك موردان. إجمالي الطلبات ٤ طلبات منها طلب واحد مفتوح.",
    );
    expect(summary).not.toContain("٨٥٠");
    expect(summary).not.toContain("إجمالي الالتزامات");
  });

  it("handles when all orders are completed", () => {
    expect(
      buildProcurementVoiceSummary({
        supplierCount: 1,
        orderCount: 2,
        openOrderCount: 0,
        canReadCost: false,
      }),
    ).toBe("عندك مورد واحد. إجمالي الطلبات طلبان وكل الطلبات مكتملة.");
  });

  it("handles empty procurement data", () => {
    expect(
      buildProcurementVoiceSummary({
        supplierCount: 0,
        orderCount: 0,
        openOrderCount: 0,
        canReadCost: true,
      }),
    ).toBe("لا توجد طلبات توريد أو موردون بعد.");
  });
});

describe("buildPaymentsVoiceSummary", () => {
  it("speaks revenue, paid and outstanding", () => {
    expect(
      buildPaymentsVoiceSummary({
        acceptedRevenueOmr: "500.000",
        paidOmr: "150.000",
        outstandingOmr: "350.000",
        canReadCost: false,
      }),
    ).toBe(
      "الإيراد المقبول ٥٠٠ ريال. المدفوع ١٥٠ ريال. المتبقي على العميل ٣٥٠ ريال.",
    );
  });

  it("speaks cost and margin only when authorized", () => {
    const base = {
      acceptedRevenueOmr: "500.000",
      paidOmr: "150.000",
      outstandingOmr: "350.000",
      committedCostOmr: "50.000",
      grossMarginOmr: "450.000",
    };
    expect(buildPaymentsVoiceSummary({ ...base, canReadCost: false })).not.toContain(
      "التكلفة",
    );
    expect(buildPaymentsVoiceSummary({ ...base, canReadCost: true })).toContain(
      "التكلفة الملتزم بها ٥٠ ريال.",
    );
    expect(buildPaymentsVoiceSummary({ ...base, canReadCost: true })).toContain(
      "الهامش الإجمالي الحالي ٤٥٠ ريال.",
    );
  });

  it("handles empty financial data", () => {
    expect(buildPaymentsVoiceSummary({ canReadCost: true })).toBe(
      "لا توجد بيانات مالية بعد.",
    );
  });
});
