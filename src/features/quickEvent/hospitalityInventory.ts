/**
 * The office's real hospitality inventory — the full kit that goes out on a
 * lane, not just coffee pots. Pure data; seeded once into catalog categories
 * + items (REUSABLE_EQUIPMENT → tracked in the warehouse ledger with a
 * capacity row; CONSUMABLE → tracked in consumable stock).
 *
 * The owner can rename, add or deactivate any of these from «دليل الخدمات
 * والمواد» afterwards — this is a starting kit, not a lock-in.
 */

import type { CatalogItemType } from "@/lib/dbTypes";

export interface InventoryItemSpec {
  name: string;
  unit: string;
  type: Extract<CatalogItemType, "REUSABLE_EQUIPMENT" | "CONSUMABLE">;
  /** Suggested quantity per lane (مسار) for the auto-prepared equipment list. */
  perLane?: number;
  /** Suggested quantity per event regardless of lanes. */
  perEvent?: number;
}

export interface InventoryCategorySpec {
  name: string;
  items: ReadonlyArray<InventoryItemSpec>;
}

export const HOSPITALITY_INVENTORY: ReadonlyArray<InventoryCategorySpec> = [
  {
    name: "القهوة والشاي",
    items: [
      { name: "دلة قهوة عمانية", unit: "دلة", type: "REUSABLE_EQUIPMENT", perLane: 5 },
      { name: "ترمس قهوة كبير", unit: "ترمس", type: "REUSABLE_EQUIPMENT", perLane: 2 },
      { name: "ترمس شاي", unit: "ترمس", type: "REUSABLE_EQUIPMENT", perLane: 2 },
      { name: "براد شاي", unit: "براد", type: "REUSABLE_EQUIPMENT", perLane: 1 },
      { name: "سماور", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perEvent: 1 },
      { name: "مبخرة", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perLane: 1 },
    ],
  },
  {
    name: "الفناجين والأكواب",
    items: [
      { name: "فناجين زجاجية VIP", unit: "فنجان", type: "REUSABLE_EQUIPMENT", perLane: 60 },
      { name: "فناجين فرطاسية (بورسلين)", unit: "فنجان", type: "REUSABLE_EQUIPMENT", perLane: 60 },
      { name: "فناجين قهوة عربية", unit: "فنجان", type: "REUSABLE_EQUIPMENT", perLane: 100 },
      { name: "بيالات شاي", unit: "بيالة", type: "REUSABLE_EQUIPMENT", perLane: 60 },
      { name: "أكواب ماء زجاجية", unit: "كوب", type: "REUSABLE_EQUIPMENT", perLane: 60 },
      { name: "أكواب ورقية", unit: "كوب", type: "CONSUMABLE", perLane: 100 },
    ],
  },
  {
    name: "الأواني والتقديم",
    items: [
      { name: "صواني تقديم ستانلس", unit: "صينية", type: "REUSABLE_EQUIPMENT", perLane: 6 },
      { name: "صحون تمر", unit: "صحن", type: "REUSABLE_EQUIPMENT", perLane: 10 },
      { name: "صحون حلوى", unit: "صحن", type: "REUSABLE_EQUIPMENT", perLane: 10 },
      { name: "صحون فواكه", unit: "صحن", type: "REUSABLE_EQUIPMENT", perLane: 6 },
      { name: "أطباق تقديم كبيرة", unit: "طبق", type: "REUSABLE_EQUIPMENT", perLane: 4 },
      { name: "ملاعق وشوك", unit: "طقم", type: "REUSABLE_EQUIPMENT", perLane: 60 },
      { name: "مناديل قماش", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perLane: 30 },
      { name: "سلال خبز", unit: "سلة", type: "REUSABLE_EQUIPMENT", perLane: 4 },
      { name: "براد ماء / كولر", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perLane: 1 },
    ],
  },
  {
    name: "الطاولات والفرش",
    items: [
      { name: "طاولة مستطيلة", unit: "طاولة", type: "REUSABLE_EQUIPMENT", perLane: 4 },
      { name: "طاولة مستديرة", unit: "طاولة", type: "REUSABLE_EQUIPMENT" },
      { name: "طاولة بوفيه", unit: "طاولة", type: "REUSABLE_EQUIPMENT", perLane: 2 },
      { name: "كرسي", unit: "كرسي", type: "REUSABLE_EQUIPMENT" },
      { name: "مفرش طاولة أبيض", unit: "مفرش", type: "REUSABLE_EQUIPMENT", perLane: 6 },
      { name: "مفرش طاولة ملون", unit: "مفرش", type: "REUSABLE_EQUIPMENT" },
      { name: "تنورة طاولة (سكيرت)", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perLane: 4 },
      { name: "غطاء كرسي", unit: "غطاء", type: "REUSABLE_EQUIPMENT" },
      { name: "سجاد / فرش أرضية", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perLane: 2 },
      { name: "مساند ظهر", unit: "مسند", type: "REUSABLE_EQUIPMENT" },
    ],
  },
  {
    name: "الديكور والإضاءة",
    items: [
      { name: "مزهرية / زهور صناعية", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perLane: 4 },
      { name: "شموع وحوامل", unit: "طقم", type: "REUSABLE_EQUIPMENT" },
      { name: "إضاءة ليد شريطية", unit: "لفة", type: "REUSABLE_EQUIPMENT" },
      { name: "توصيلة كهرباء", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perEvent: 3 },
      { name: "لافتة ترحيب", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perEvent: 1 },
    ],
  },
  {
    name: "المواد الاستهلاكية",
    items: [
      { name: "كلينكس مرطب", unit: "علبة", type: "CONSUMABLE", perLane: 4 },
      { name: "كلينكس جاف", unit: "علبة", type: "CONSUMABLE", perLane: 4 },
      { name: "أكياس نفايات صغيرة", unit: "لفة", type: "CONSUMABLE", perLane: 1 },
      { name: "أكياس نفايات كبيرة", unit: "لفة", type: "CONSUMABLE", perLane: 1 },
      { name: "قفازات", unit: "علبة", type: "CONSUMABLE", perEvent: 2 },
      { name: "مناديل ورقية للطاولات", unit: "علبة", type: "CONSUMABLE", perLane: 3 },
      { name: "ماء معبأ (كرتون)", unit: "كرتون", type: "CONSUMABLE", perLane: 3 },
      { name: "قهوة عمانية (كجم)", unit: "كجم", type: "CONSUMABLE", perLane: 1 },
      { name: "هيل / زعفران / ماء ورد", unit: "مجموعة", type: "CONSUMABLE", perEvent: 1 },
      { name: "شاي (علبة)", unit: "علبة", type: "CONSUMABLE", perLane: 1 },
      { name: "سكر (كجم)", unit: "كجم", type: "CONSUMABLE", perLane: 1 },
      { name: "تمر (كجم)", unit: "كجم", type: "CONSUMABLE", perLane: 3 },
      { name: "لبان / بخور", unit: "علبة", type: "CONSUMABLE", perEvent: 1 },
      { name: "معقم يدين", unit: "عبوة", type: "CONSUMABLE", perLane: 1 },
    ],
  },
  {
    name: "القرطاسية والتنظيم",
    items: [
      { name: "لوح تسجيل حضور", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perEvent: 1 },
      { name: "أقلام", unit: "علبة", type: "CONSUMABLE", perEvent: 1 },
      { name: "بطاقات أسماء الطاولات", unit: "رزمة", type: "CONSUMABLE" },
      { name: "شريط لاصق", unit: "لفة", type: "CONSUMABLE", perEvent: 2 },
      { name: "مقص", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perEvent: 1 },
      { name: "كشف جرد المعدات (مطبوع)", unit: "نسخة", type: "CONSUMABLE", perEvent: 1 },
    ],
  },
  {
    name: "النقل والتعبئة",
    items: [
      { name: "صندوق نقل بلاستيك", unit: "صندوق", type: "REUSABLE_EQUIPMENT", perLane: 3 },
      { name: "حقيبة فناجين مبطنة", unit: "حقيبة", type: "REUSABLE_EQUIPMENT", perLane: 2 },
      { name: "عربة نقل (ترولي)", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perEvent: 1 },
      { name: "ثلاجة / آيس بوكس", unit: "قطعة", type: "REUSABLE_EQUIPMENT", perLane: 1 },
    ],
  },
];

export const ALL_INVENTORY_ITEMS: ReadonlyArray<InventoryItemSpec & { category: string }> =
  HOSPITALITY_INVENTORY.flatMap((c) => c.items.map((i) => ({ ...i, category: c.name })));

/** Suggested kit for a given number of lanes — what the warehouse should
 *  prepare for this event. Items with no per-lane/per-event rule are skipped
 *  (they're situational: chairs, round tables…). */
export function suggestedKit(lanes: number): Array<{ name: string; quantity: number; type: InventoryItemSpec["type"] }> {
  const n = Math.max(1, lanes);
  return ALL_INVENTORY_ITEMS.flatMap((i) => {
    const qty = (i.perLane ?? 0) * n + (i.perEvent ?? 0);
    return qty > 0 ? [{ name: i.name, quantity: qty, type: i.type }] : [];
  });
}
