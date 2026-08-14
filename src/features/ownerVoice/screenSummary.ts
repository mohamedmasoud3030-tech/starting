/**
 * Owner Voice — deterministic Arabic screen summaries.
 *
 * Pure functions: no DOM, no browser APIs, no network, no AI, no floating
 * point as a source of truth. Each builder takes the SAME structured domain
 * data the screen already renders, so the spoken output can never exceed what
 * the current role is authorized to see on that screen.
 *
 * Nothing here ever reads the DOM and nothing here can run automatically:
 * the OwnerVoiceButton only speaks when the owner presses it.
 */

export const DEFAULT_TIME_ZONE = "Asia/Muscat";

export interface ReadinessLike {
  status: string;
  staff_missing: number;
  equipment_shortage: number;
}

export interface EventLike {
  id: string;
  event_number: string;
  title: string;
  start_at: string;
  end_at?: string | null;
  status: string;
  venue_name: string;
  guest_count: number;
  customer_name?: string | null;
}

export interface EventWithReadiness extends EventLike {
  readiness?: ReadinessLike | null;
}

export interface HomeSummaryInput {
  events: EventWithReadiness[];
  now?: Date;
  timeZone?: string;
}

export interface EventsListSummaryInput {
  events: EventLike[];
  now?: Date;
  timeZone?: string;
}

export interface EventSummaryInput {
  event: EventLike;
  readiness: ReadinessLike | null;
  now?: Date;
  timeZone?: string;
}

export interface QuoteSummaryInput {
  /** Exact 3-decimal OMR string (or milli-value) — never a float sum. */
  totalSellingOmr: string | number | null;
  expectedCostOmr?: string | number | null;
  expectedProfitOmr?: string | number | null;
  /**
   * Voice must obey the EXACT same permission as the visual UI. When false,
   * expected cost / profit are NEVER spoken, even if values were passed.
   */
  canReadCost: boolean;
  quotationNumber?: string | null;
  quotationStatus?: string | null;
  /** Payment data does not exist yet in S1–S3; slot in when it arrives. */
  paidOmr?: string | number | null;
  remainingOmr?: string | number | null;
}

export const EVENT_STATUS_ARABIC: Record<string, string> = {
  DRAFT: "مسودة",
  QUOTED: "مسعّرة",
  CONFIRMED: "مؤكدة",
  PREPARING: "قيد التجهيز",
  DISPATCHED: "تم الإرسال",
  IN_PROGRESS: "جارية",
  RETURNING: "قيد الإرجاع",
  CLOSED: "مغلقة",
  CANCELLED: "ملغاة",
};

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"] as const;

const WEEKDAY_NAMES = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

// ------------------------------------------------------------------ numbers

/** Convert Latin digits to Arabic-Indic digits (١٢٥), keeping other chars. */
export function toArabicDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => {
    const arabic = ARABIC_DIGITS[Number(digit)];
    return arabic ?? digit;
  });
}

/**
 * "EV-2026-00125" → "١٢٥": speak only the meaningful sequence number, like
 * the owner would ("مناسبة رقم 125"), not the full machine code.
 */
export function spokenEventNumber(eventNumber: string): string {
  return spokenDocumentNumber(eventNumber);
}

/** Same for quotation numbers ("QT-2026-00042" → "٤٢"). */
export function spokenQuoteNumber(quotationNumber: string): string {
  return spokenDocumentNumber(quotationNumber);
}

function spokenDocumentNumber(code: string): string {
  const sequence = /(?:^|-)(\d+)$/.exec(code.trim())?.[1];
  if (sequence === undefined) return toArabicDigits(code);
  return toArabicDigits(Number.parseInt(sequence, 10));
}

export interface ArabicCountForms {
  /** 1 → "مناسبة واحدة" (count word included) */
  one: string;
  /** 2 → "مناسبتان" (dual word form) */
  two: string;
  /** 3–10 → bare plural noun ("مناسبات") — digits are prepended */
  few: string;
  /** 11+ → singular noun ("مناسبة") — digits are prepended */
  many: string;
}

/**
 * Practical Arabic count phrase:
 *   1 → one, 2 → two, 3–10 → "٣ few", 11+ → "١١ many", 0 → few (callers guard zero).
 */
export function arabicCountPhrase(count: number, forms: ArabicCountForms): string {
  if (count === 1) return forms.one;
  if (count === 2) return forms.two;
  if (count >= 3 && count <= 10) return `${toArabicDigits(count)} ${forms.few}`;
  if (count > 10) return `${toArabicDigits(count)} ${forms.many}`;
  return forms.few;
}

/** "الفريق ناقص شخصين" — accusative count for the workspace sentence. */
export function staffShortageFragment(missing: number): string {
  if (missing === 1) return "شخص واحد";
  if (missing === 2) return "شخصين";
  return toArabicDigits(missing);
}

/** Home style: "ناقصها شخصان من الفريق". */
export function staffMissingPhrase(missing: number): string {
  if (missing === 1) return "شخص واحد من الفريق";
  if (missing === 2) return "شخصان من الفريق";
  return `${toArabicDigits(missing)} من الفريق`;
}

export function equipmentShortagePhrase(missing: number): string {
  return `${toArabicDigits(missing)} من المعدات`;
}

/** Workspace sentence for readiness (or null when unknown). */
export function readinessSentence(readiness: ReadinessLike | null): string {
  if (!readiness) return "";
  switch (readiness.status) {
    case "READY":
      return "المناسبة جاهزة.";
    case "STAFF_MISSING":
      return `الفريق ناقص ${staffShortageFragment(readiness.staff_missing)}.`;
    case "EQUIPMENT_SHORTAGE":
      return `المعدات ناقصة ${toArabicDigits(readiness.equipment_shortage)}.`;
    case "MULTIPLE_ISSUES":
      return `الفريق ناقص ${staffShortageFragment(readiness.staff_missing)} والمعدات ناقصة ${toArabicDigits(readiness.equipment_shortage)}.`;
    default:
      return "";
  }
}

/** Home per-event shortage: "ناقصها شخصان من الفريق". */
function shortageFragment(readiness: ReadinessLike): string {
  switch (readiness.status) {
    case "STAFF_MISSING":
      return `ناقصها ${staffMissingPhrase(readiness.staff_missing)}`;
    case "EQUIPMENT_SHORTAGE":
      return `ناقصها ${equipmentShortagePhrase(readiness.equipment_shortage)}`;
    case "MULTIPLE_ISSUES":
      return `ناقصها ${staffMissingPhrase(readiness.staff_missing)} و ${equipmentShortagePhrase(readiness.equipment_shortage)}`;
    default:
      return "";
  }
}

// ------------------------------------------------------------ time (Muscat)

interface TzParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function toTzParts(iso: string, timeZone: string): TzParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(iso));
  const read = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  let hour = read("hour");
  if (hour === 24) hour = 0; // some locales report midnight as 24:00
  return { year: read("year"), month: read("month"), day: read("day"), hour, minute: read("minute") };
}

function tzDayUtc(parts: TzParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function tzDayDiff(a: TzParts, b: TzParts): number {
  return Math.round((tzDayUtc(a) - tzDayUtc(b)) / 86_400_000);
}

/** True when `iso` falls on the same calendar day as `reference` in `timeZone`. */
export function isSameLocalDay(
  iso: string,
  reference: Date,
  timeZone = DEFAULT_TIME_ZONE,
): boolean {
  const a = toTzParts(iso, timeZone);
  const b = toTzParts(reference.toISOString(), timeZone);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function weekdayName(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  const parts = toTzParts(iso, timeZone);
  const name = WEEKDAY_NAMES[new Date(tzDayUtc(parts)).getUTCDay()];
  return name ?? "";
}

/** "اليوم" / "غداً" / "يوم الأحد" / "بتاريخ ١٥ أغسطس" */
export function spokenDayPhrase(
  iso: string,
  now: Date,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const a = toTzParts(iso, timeZone);
  const b = toTzParts(now.toISOString(), timeZone);
  const diff = tzDayDiff(a, b);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "غداً";
  if (diff >= 2 && diff <= 6) return `يوم ${weekdayName(iso, timeZone)}`;
  const dateLabel = new Intl.DateTimeFormat("ar", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
  }).format(new Date(tzDayUtc(a)));
  return `بتاريخ ${toArabicDigits(dateLabel)}`;
}

/** "الساعة ٧ مساءً" / "الساعة ١ و ٣٠ دقيقة ظهراً" */
export function spokenHourPhrase(hour24: number, minute: number): string {
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period =
    hour24 < 5
      ? "ليلاً"
      : hour24 < 12
        ? "صباحاً"
        : hour24 < 16
          ? "ظهراً"
          : hour24 < 18
            ? "عصراً"
            : "مساءً";
  const minutes = minute > 0 ? ` و ${toArabicDigits(minute)} دقيقة` : "";
  return `الساعة ${toArabicDigits(hour12)}${minutes} ${period}`;
}

/** "اليوم الساعة ٧ مساءً" */
export function spokenTimePhrase(
  iso: string,
  now: Date,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const parts = toTzParts(iso, timeZone);
  return `${spokenDayPhrase(iso, now, timeZone)} ${spokenHourPhrase(parts.hour, parts.minute)}`;
}

// ------------------------------------------------------------------- money

/**
 * Narration-only formatting of an exact 3-decimal OMR value ("850.000" →
 * "٨٥٠ ريال"). Never computes money; only formats what the caller passes.
 */
export function omrToSpoken(
  value: string | number | null | undefined,
): string | null {
  if (value == null || value === "") return null;
  const text = String(value).trim().replace(/[\s,،]/g, "");
  const match = /^(-)?(\d+)(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) return null;
  const negative = match[1] === "-";
  const intPart = match[2] ?? "0";
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const amount = fraction ? `${intPart}.${fraction}` : intPart;
  const digits = toArabicDigits(amount).replace(".", "٫");
  return `${negative ? "سالب " : ""}${digits} ريال`;
}

// ---------------------------------------------------------------- builders

/**
 * Home / owner dashboard: what is happening today and what needs attention.
 *
 * Example:
 * "عندك اليوم ٣ مناسبات. مناسبتان جاهزتان. مناسبة قاعة الريان اليوم الساعة
 * ٧ مساءً ناقصها شخصان من الفريق. لا توجد مشاكل أخرى تحتاج تدخل الآن."
 */
export function buildHomeVoiceSummary(input: HomeSummaryInput): string {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;

  const today = input.events.filter(
    (e) => e.status !== "CANCELLED" && isSameLocalDay(e.start_at, now, timeZone),
  );
  if (today.length === 0) return "لا توجد مناسبات اليوم.";

  const parts: string[] = [];
  parts.push(
    `عندك اليوم ${arabicCountPhrase(today.length, {
      one: "مناسبة واحدة",
      two: "مناسبتان",
      few: "مناسبات",
      many: "مناسبة",
    })}.`,
  );

  const ready = today.filter((e) => e.readiness?.status === "READY");
  if (ready.length > 0) {
    parts.push(
      `${arabicCountPhrase(ready.length, {
        one: "مناسبة واحدة جاهزة",
        two: "مناسبتان جاهزتان",
        few: "مناسبات جاهزة",
        many: "مناسبة جاهزة",
      })}.`,
    );
  }

  const issues = today.filter(
    (e): e is EventWithReadiness & { readiness: ReadinessLike } =>
      e.readiness !== null &&
      e.readiness !== undefined &&
      e.readiness.status !== "READY",
  );
  const unknown = today.filter((e) => !e.readiness);

  for (const issue of issues) {
    parts.push(
      `مناسبة ${issue.venue_name} ${spokenTimePhrase(issue.start_at, now, timeZone)} ${shortageFragment(issue.readiness)}.`,
    );
  }

  if (unknown.length === 0) {
    parts.push(
      issues.length > 0
        ? "لا توجد مشاكل أخرى تحتاج تدخل الآن."
        : "لا توجد مشاكل تحتاج تدخل الآن.",
    );
  }
  return parts.join(" ");
}

/** Events list: total, status highlights, and the next upcoming event. */
export function buildEventsListVoiceSummary(
  input: EventsListSummaryInput,
): string {
  const events = input.events;
  if (events.length === 0) return "لا توجد مناسبات مسجلة.";

  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;

  const parts: string[] = [];
  parts.push(
    `عندك ${arabicCountPhrase(events.length, {
      one: "مناسبة واحدة",
      two: "مناسبتان",
      few: "مناسبات",
      many: "مناسبة",
    })}.`,
  );

  const STATUS_GROUPS: ReadonlyArray<{
    status: string;
    forms: ArabicCountForms;
  }> = [
    {
      status: "CONFIRMED",
      forms: {
        one: "مناسبة واحدة مؤكدة",
        two: "مناسبتان مؤكدتان",
        few: "مناسبات مؤكدة",
        many: "مناسبة مؤكدة",
      },
    },
    {
      status: "PREPARING",
      forms: {
        one: "مناسبة واحدة قيد التجهيز",
        two: "مناسبتان قيد التجهيز",
        few: "مناسبات قيد التجهيز",
        many: "مناسبة قيد التجهيز",
      },
    },
    {
      status: "IN_PROGRESS",
      forms: {
        one: "مناسبة واحدة جارية",
        two: "مناسبتان جاريتان",
        few: "مناسبات جارية",
        many: "مناسبة جارية",
      },
    },
    {
      status: "CANCELLED",
      forms: {
        one: "مناسبة واحدة ملغاة",
        two: "مناسبتان ملغاتان",
        few: "مناسبات ملغاة",
        many: "مناسبة ملغاة",
      },
    },
  ];

  const highlights = STATUS_GROUPS.map((group) => ({
    group,
    count: events.filter((e) => e.status === group.status).length,
  })).filter((h) => h.count > 0);

  if (highlights.length > 0) {
    parts.push(
      `منها ${highlights
        .map(
          (h) =>
            arabicCountPhrase(h.count, {
              one: h.group.forms.one,
              two: h.group.forms.two,
              few: h.group.forms.few,
              many: h.group.forms.many,
            }),
        )
        .join(" و ")}.`,
    );
  }

  const upcoming = events
    .filter(
      (e) =>
        e.status !== "CANCELLED" &&
        new Date(e.start_at).getTime() > now.getTime(),
    )
    .sort(
      (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    );
  const next = upcoming[0];
  if (next) {
    parts.push(
      `المناسبة القادمة ${next.title} ${spokenTimePhrase(next.start_at, now, timeZone)}.`,
    );
  } else {
    parts.push("لا توجد مناسبات قادمة.");
  }

  return parts.join(" ");
}

/**
 * Event workspace: number, time, customer, location, guests, status,
 * readiness and shortages — in that priority order, nothing else.
 */
export function buildEventVoiceSummary(input: EventSummaryInput): string {
  const event = input.event;
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;

  const parts: string[] = [];
  parts.push(
    `مناسبة رقم ${spokenEventNumber(event.event_number)} ${spokenTimePhrase(event.start_at, now, timeZone)}.`,
  );
  if (event.customer_name) parts.push(`العميل ${event.customer_name}.`);
  parts.push(`الموقع ${event.venue_name}.`);
  parts.push(`عدد الضيوف ${toArabicDigits(event.guest_count)}.`);
  parts.push(
    `المناسبة ${EVENT_STATUS_ARABIC[event.status] ?? event.status}.`,
  );

  // A cancelled event's readiness is stale — never narrate it.
  if (event.status !== "CANCELLED" && input.readiness) {
    const sentence = readinessSentence(input.readiness);
    if (sentence) parts.push(sentence);
  }
  return parts.join(" ");
}

/**
 * Quotation / commercial summary. Cost and profit are spoken ONLY when the
 * current role is already authorized to see them on the pricing screen.
 */
export function buildQuoteVoiceSummary(input: QuoteSummaryInput): string {
  const total = omrToSpoken(input.totalSellingOmr);
  const paid = omrToSpoken(input.paidOmr);
  const remaining = omrToSpoken(input.remainingOmr);
  const hasData =
    total !== null ||
    input.quotationNumber != null ||
    paid !== null ||
    remaining !== null ||
    (input.canReadCost &&
      (input.expectedCostOmr != null || input.expectedProfitOmr != null));

  if (!hasData) return "لا توجد بيانات تسعير بعد.";

  const parts: string[] = [];
  if (total) parts.push(`إجمالي الاتفاق ${total}.`);

  if (input.quotationNumber) {
    parts.push(
      `عرض السعر رقم ${spokenQuoteNumber(input.quotationNumber)}${input.quotationStatus === "ACCEPTED" ? " معتمد" : ""}.`,
    );
  }

  if (paid) parts.push(`المدفوع ${paid}.`);
  if (remaining) parts.push(`المتبقي ${remaining}.`);

  // Hard permission gate: cost/profit are spoken only when authorized.
  if (input.canReadCost) {
    const cost = omrToSpoken(input.expectedCostOmr);
    if (cost) parts.push(`التكلفة المتوقعة ${cost}.`);
    const profit = omrToSpoken(input.expectedProfitOmr);
    if (profit) parts.push(`الربح المتوقع ${profit}.`);
  }

  return parts.join(" ");
}
