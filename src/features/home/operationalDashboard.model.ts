import {
  buildAttentionVoiceSummary,
  DEFAULT_TIME_ZONE,
  isSameLocalDay,
  toArabicDigits,
} from "@/features/ownerVoice/screenSummary";

export interface OperationalEvent {
  id: string;
  event_number: string;
  title: string;
  start_at: string;
  status: string;
  venue_name: string;
  guest_count: number;
  contact_phone?: string | null;
}

export interface OperationalReadiness {
  status: string;
  staff_missing: number;
  equipment_shortage: number;
}

export interface OperationalStockLine {
  stockItemId: string;
  itemName: string;
  isTrackingActive: boolean;
  isLowStock: boolean;
}

export type OperationalAlert =
  | {
      id: string;
      kind: "EVENT";
      severity: "warning" | "danger";
      title: string;
      detail: string;
      eventId: string;
    }
  | {
      id: string;
      kind: "STOCK";
      severity: "warning";
      title: string;
      detail: string;
    };

export interface OperationalDashboard {
  todayEvents: OperationalEvent[];
  readyCount: number;
  eventAttentionCount: number;
  lowStockCount: number;
  alerts: OperationalAlert[];
}

/**
 * A metric that is only a number once its underlying query has actually
 * resolved. `null` means "not established yet" and MUST render as "—", never
 * as 0: AGENTS.md forbids presenting an invented statistic as fact, and a
 * confident "0 events need attention" on an unresolved query is exactly that.
 */
export type PendingCount = number | null;

/** Resolves a count only when its source has loaded. */
export function settledCount(
  loaded: boolean,
  value: number | undefined,
): PendingCount {
  return loaded ? (value ?? 0) : null;
}

/**
 * The dashboard voice summary — or `null` (voice button hidden) while any
 * source is still unresolved.
 *
 * A spoken summary is a statement of fact; building it from zeroed
 * placeholders while queries load made the owner hear a confident
 * "لا توجد مناسبات اليوم" for an unresolved dashboard — the same
 * fabricated-zero class the visual metrics guard against with
 * `settledCount`.
 */
export function attentionSummaryWhenLoaded(input: {
  loaded: boolean;
  dashboard: Pick<
    OperationalDashboard,
    "todayEvents" | "readyCount" | "eventAttentionCount" | "lowStockCount"
  >;
  attendanceGapCount: PendingCount;
  canReadFinance: boolean;
}): string | null {
  if (!input.loaded || input.attendanceGapCount === null) return null;
  return buildAttentionVoiceSummary({
    todayEventCount: input.dashboard.todayEvents.length,
    readyCount: input.dashboard.readyCount,
    attentionCount: input.dashboard.eventAttentionCount,
    lowStockCount: input.dashboard.lowStockCount,
    attendanceGapCount: input.attendanceGapCount,
    canReadFinance: input.canReadFinance,
  });
}

function readinessDetail(readiness: OperationalReadiness): string {
  switch (readiness.status) {
    case "STAFF_MISSING":
      return `الفريق ناقص ${toArabicDigits(readiness.staff_missing)}.`;
    case "EQUIPMENT_SHORTAGE":
      return `المعدات ناقصة ${toArabicDigits(readiness.equipment_shortage)}.`;
    case "MULTIPLE_ISSUES":
      return `الفريق ناقص ${toArabicDigits(readiness.staff_missing)} والمعدات ناقصة ${toArabicDigits(readiness.equipment_shortage)}.`;
    default:
      return "تحتاج مراجعة الجاهزية قبل التنفيذ.";
  }
}

export function buildOperationalDashboard(input: {
  events: OperationalEvent[];
  readinessByEventId: Record<string, OperationalReadiness | null | undefined>;
  stockLines: OperationalStockLine[];
  now?: Date;
  timeZone?: string;
}): OperationalDashboard {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;

  const todayEvents = input.events
    .filter(
      (event) =>
        event.status !== "CANCELLED" &&
        isSameLocalDay(event.start_at, now, timeZone),
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  const alerts: OperationalAlert[] = [];
  let readyCount = 0;
  let eventAttentionCount = 0;

  for (const event of todayEvents) {
    const readiness = input.readinessByEventId[event.id];
    if (readiness?.status === "READY") {
      readyCount += 1;
      continue;
    }

    eventAttentionCount += 1;
    if (readiness == null) {
      alerts.push({
        id: `event:${event.id}:readiness-unavailable`,
        kind: "EVENT",
        severity: "warning",
        title: `${event.title} — الجاهزية غير متاحة`,
        detail: "تعذر التحقق من الجاهزية الآن. افتح المناسبة وراجع الفريق والمعدات.",
        eventId: event.id,
      });
      continue;
    }

    alerts.push({
      id: `event:${event.id}:readiness`,
      kind: "EVENT",
      severity: readiness.status === "MULTIPLE_ISSUES" ? "danger" : "warning",
      title: `${event.title} — تحتاج تدخل`,
      detail: readinessDetail(readiness),
      eventId: event.id,
    });
  }

  const lowStock = input.stockLines
    .filter((line) => line.isTrackingActive && line.isLowStock)
    .sort((a, b) => a.itemName.localeCompare(b.itemName, "ar"));

  for (const line of lowStock) {
    alerts.push({
      id: `stock:${line.stockItemId}`,
      kind: "STOCK",
      severity: "warning",
      title: `مخزون منخفض — ${line.itemName}`,
      detail: "الكمية الحالية وصلت إلى الحد الأدنى أو أقل. راجع المواد الاستهلاكية.",
    });
  }

  return {
    todayEvents,
    readyCount,
    eventAttentionCount,
    lowStockCount: lowStock.length,
    alerts,
  };
}

/**
 * Whether a signed-in workspace is brand new — no events and no customers yet.
 * This is the state a first-time user lands in, so it gates the onboarding
 * "first steps" panel. Every input must be *settled* (`null` = unknown ⇒ not
 * "new", so an unresolved query never shows onboarding as a false positive).
 */
export function isNewWorkspace(input: {
  eventsLoaded: boolean;
  eventCount: number | null;
  customersLoaded: boolean;
  customerCount: number | null;
}): boolean {
  if (
    !input.eventsLoaded ||
    !input.customersLoaded ||
    input.eventCount === null ||
    input.customerCount === null
  ) {
    return false;
  }
  return input.eventCount === 0 && input.customerCount === 0;
}

export function normalizeWhatsAppPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) digits = `968${digits}`;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function buildEventWhatsAppUrl(
  event: OperationalEvent,
  timeZone = DEFAULT_TIME_ZONE,
): string | null {
  const phone = normalizeWhatsAppPhone(event.contact_phone);
  if (!phone) return null;

  const date = new Intl.DateTimeFormat("ar-OM", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(event.start_at));

  const message = [
    `تذكير بالمناسبة: ${event.title}`,
    `رقم المناسبة: ${event.event_number}`,
    `الموعد: ${date}`,
    `الموقع: ${event.venue_name}`,
    `عدد الضيوف: ${event.guest_count}`,
  ].join("\n");

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
