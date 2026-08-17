import { describe, expect, it } from "vitest";
import { arabicError } from "./events.api";

describe("Arabic Event domain errors", () => {
  it("explains a staff overlap", () => {
    expect(arabicError(new Error("STAFF_CONFLICT"))).toBe(
      "الموظف مرتبط بمناسبة أخرى في هذا الوقت",
    );
  });

  it("explains equipment shortage", () => {
    expect(arabicError(new Error("EQUIPMENT_SHORTAGE"))).toBe(
      "الكمية المطلوبة غير متاحة في هذا الوقت",
    );
  });

  it("explains immutable accepted pricing", () => {
    expect(arabicError(new Error("EVENT_PRICING_LOCKED"))).toBe(
      "تم اعتماد العرض ولا يمكن تعديل التسعير",
    );
  });

  it("explains create-event validation failures in Arabic", () => {
    expect(arabicError(new Error("INVALID_EVENT_WINDOW"))).toBe(
      "تاريخ النهاية يجب أن يكون بعد البداية",
    );
    expect(arabicError(new Error("INVALID_GUEST_COUNT"))).toBe(
      "عدد الضيوف يجب أن يكون واحداً على الأقل",
    );
    expect(arabicError(new Error("CUSTOMER_NOT_IN_ORG"))).toBe(
      "العميل غير موجود في منشأتك أو غير نشط",
    );
  });

  it("explains operational command failures in Arabic", () => {
    expect(arabicError(new Error("CANCELLATION_REASON_REQUIRED"))).toBe(
      "اكتب سبب الإلغاء بوضوح قبل المتابعة",
    );
    expect(arabicError(new Error("EVENT_CANNOT_BE_CANCELLED"))).toBe(
      "لا يمكن إلغاء المناسبة في حالتها الحالية",
    );
    expect(arabicError(new Error("RESERVATION_HAS_OUTSTANDING_EQUIPMENT"))).toBe(
      "لا يمكن تحرير الحجز ومعدات ما زالت في الخارج",
    );
    expect(arabicError(new Error("CONSUMABLE_STOCK_SHORTAGE"))).toBe(
      "رصيد المادة لا يكفي لهذه الكمية",
    );
  });

  it("explains finance and transition failures in Arabic", () => {
    expect(arabicError(new Error("EVENT_NOT_PAYABLE"))).toBe(
      "هذه المناسبة لا تقبل الدفعات حالياً",
    );
    expect(arabicError(new Error("PAYMENT_REQUIRES_ACCEPTED_QUOTATION"))).toBe(
      "لا يمكن تسجيل دفعة قبل اعتماد عرض سعر لهذه المناسبة",
    );
    expect(
      arabicError(new Error("INVALID_EVENT_TRANSITION: PREPARING -> CLOSED")),
    ).toBe("لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية");
  });

  it("maps database constraint violations to Arabic guidance", () => {
    expect(
      arabicError(
        new Error(
          'new row violates row-level security policy... detail: Failing row contains (events_valid_window)...',
        ),
      ),
    ).toBe("تاريخ النهاية يجب أن يكون بعد البداية");
    expect(
      arabicError(new Error("value for domain events_guest_count_check")),
    ).toBe("عدد الضيوف يجب أن يكون واحداً على الأقل");
  });

  it("never leaks a raw machine code and falls back to Arabic", () => {
    const message = arabicError(new Error("SOME_UNKNOWN_FUTURE_CODE"));
    expect(message).toBe("حدث خطأ غير متوقع في هذه العملية. أعد المحاولة.");
    expect(message).not.toContain("SOME_UNKNOWN_FUTURE_CODE");
  });
});
