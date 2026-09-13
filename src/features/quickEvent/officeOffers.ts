/**
 * The office's standard hospitality offers («العروض») exactly as printed on
 * the price sheet of «مشاريع جودة الانطلاقة للخدمات — قسم خدمات الضيافة».
 *
 * Pure data + pure functions: no I/O. The seeding and the quick-event flow
 * read from here, so the sheet is the single source of truth for the tiers.
 */

import { toOMRString, type MilliOMR } from "@/lib/money";

/** One tier on the printed sheet. Amounts are milli-OMR (3 decimals). */
export interface OfficeOffer {
  /** 1..6 — matches «العرض الأول» … «العرض السادس». */
  tier: number;
  name: string;
  minGuests: number;
  maxGuests: number;
  lanes: number;
  hosts: number;
  supervisors: number;
  /** Arabic coffee pots («دلة»). When a range is printed we keep the upper bound. */
  coffeePots: number;
  priceMilli: MilliOMR;
}

const OMR = (n: number): MilliOMR => n * 1000;

export const OFFICE_OFFERS: ReadonlyArray<OfficeOffer> = [
  { tier: 1, name: "العرض الأول", minGuests: 20, maxGuests: 120, lanes: 1, hosts: 5, supervisors: 1, coffeePots: 5, priceMilli: OMR(140) },
  { tier: 2, name: "العرض الثاني", minGuests: 121, maxGuests: 250, lanes: 2, hosts: 10, supervisors: 1, coffeePots: 10, priceMilli: OMR(230) },
  { tier: 3, name: "العرض الثالث", minGuests: 251, maxGuests: 400, lanes: 3, hosts: 15, supervisors: 1, coffeePots: 15, priceMilli: OMR(310) },
  { tier: 4, name: "العرض الرابع", minGuests: 401, maxGuests: 600, lanes: 4, hosts: 20, supervisors: 1, coffeePots: 25, priceMilli: OMR(400) },
  { tier: 5, name: "العرض الخامس", minGuests: 601, maxGuests: 800, lanes: 5, hosts: 25, supervisors: 2, coffeePots: 30, priceMilli: OMR(480) },
  { tier: 6, name: "العرض السادس", minGuests: 801, maxGuests: 1000, lanes: 6, hosts: 30, supervisors: 2, coffeePots: 35, priceMilli: OMR(550) },
];

/** The five fixed inclusions printed under every tier. */
export const OFFER_FIXED_INCLUSIONS: ReadonlyArray<string> = [
  "فناجين زجاجية VIP",
  "فناجين فرطاسية",
  "كلينكس مرطب وجاف",
  "أواني أدوات ضيافة",
  "أكياس نفايات صغير وكبير",
];

/** Printed terms («الملاحظات والشروط العامة»). */
export const OFFER_TERMS: ReadonlyArray<string> = [
  "الأسعار المذكورة تشمل جميع مستلزمات الضيافة والخدمات الموضحة ضمن كل عرض.",
  "تسري الأسعار على المناسبات المقامة داخل حدود ولاية نزوى، وفي حال إقامة المناسبة خارج الولاية تضاف رسوم نقل حسب الموقع والمسافة.",
  "يجب تأكيد الحجز قبل موعد المناسبة بمدة لا تقل عن 72 ساعة.",
  "يتم دفع 30% من قيمة العرض عند تأكيد الحجز، واستكمال المبلغ المتبقي بعد انتهاء الخدمة أو حسب الاتفاق.",
  "يحق للعميل تعديل عدد الضيوف قبل موعد المناسبة بـ 24 ساعة كحد أقصى.",
  "الأسعار قابلة للمراجعة في حال وجود متطلبات خاصة أو خدمات إضافية غير مذكورة ضمن العرض، بشرط إبلاغنا قبل 48 ساعة.",
];

export const DEPOSIT_PERCENT = 30;

/** The tier whose guest range contains `guests`; above the top tier → the top
 *  tier (the office quotes bigger crowds manually from there). */
export function pickOfferForGuests(guests: number): OfficeOffer | null {
  if (!Number.isFinite(guests) || guests <= 0) return null;
  const exact = OFFICE_OFFERS.find((o) => guests >= o.minGuests && guests <= o.maxGuests);
  if (exact) return exact;
  if (guests < OFFICE_OFFERS[0]!.minGuests) return OFFICE_OFFERS[0]!;
  return OFFICE_OFFERS[OFFICE_OFFERS.length - 1]!;
}

export function depositMilli(priceMilli: MilliOMR): MilliOMR {
  return Math.round((priceMilli * DEPOSIT_PERCENT) / 100);
}

/** One-line human summary used in cards and WhatsApp text. */
export function describeOffer(o: OfficeOffer): string {
  const supervisors = o.supervisors === 1 ? "مشرف" : "مشرفين";
  const lanes = o.lanes === 1 ? "مسار واحد" : o.lanes === 2 ? "مسارين" : `${o.lanes} مسارات`;
  return `${o.hosts} مضيف مع ${supervisors} · ${o.coffeePots} دلة قهوة · ${lanes}`;
}

/** Catalog item names the seeder creates (also used to detect prior seeding). */
export const OFFER_CATALOG_ITEMS = {
  host: "مضيف ضيافة",
  supervisor: "مشرف ضيافة",
  coffeePot: "دلة قهوة عمانية",
  lane: "مسار ضيافة",
  transport: "رسوم نقل خارج ولاية نزوى",
  fixed: OFFER_FIXED_INCLUSIONS,
} as const;

/** WhatsApp message the owner sends to the customer right after creating the
 *  event. No costs or margins — customer-facing only. */
export function buildOfferWhatsAppText(args: {
  customerName: string;
  offer: OfficeOffer;
  guests: number;
  dateLabel: string;
  venue: string;
  eventNumber?: string | null;
  orgName: string;
}): string {
  const price = toOMRString(args.offer.priceMilli);
  const deposit = toOMRString(depositMilli(args.offer.priceMilli));
  const lines = [
    `السلام عليكم ${args.customerName}،`,
    `يسعدنا في ${args.orgName} تأكيد تفاصيل الضيافة لمناسبتكم:`,
    ``,
    `📅 الموعد: ${args.dateLabel}`,
    `📍 المكان: ${args.venue}`,
    `👥 عدد الضيوف: ${args.guests}`,
    ``,
    `✅ ${args.offer.name} — ${price} ر.ع`,
    `• ${describeOffer(args.offer)}`,
    ...OFFER_FIXED_INCLUSIONS.map((s) => `• ${s}`),
    ``,
    `💳 العربون (${DEPOSIT_PERCENT}%): ${deposit} ر.ع عند التأكيد، والباقي بعد الخدمة.`,
    `⏰ يُرجى تأكيد الحجز قبل الموعد بـ 72 ساعة.`,
  ];
  if (args.eventNumber) lines.push(``, `رقم الحجز: ${args.eventNumber}`);
  lines.push(``, `شاكرين ثقتكم 🌹`);
  return lines.join("\n");
}
