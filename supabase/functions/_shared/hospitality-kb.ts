/**
 * Hospitality operations knowledge base.
 *
 * The assistant answers operational questions from two sources only:
 * 1. The read-only context snapshot the client gathers from the canonical
 *    SQL views (its own organization's real figures), and
 * 2. This curated, versioned knowledge base of hospitality practice.
 *
 * It NEVER invents figures, prices, taxes or laws. Where a figure is not in
 * the context and not in this KB, the assistant says so plainly and steers
 * back to a covered topic.
 */

export const HOSPITALITY_KB_VERSION = "1.0.0";

export const HOSPITALITY_KB = [
  "قطاع: مكاتب خدمات الضيافة والمناسبات في سلطنة عُمان (أعراس، عزاء، مجالس، اجتماعات، وجبات، فعاليات).",
  "المناسبة (Event) هي المجمّع التشغيلي المركزي: كل ما هو تشغيلي (تجهيز، طاقم، مواد، معدات، مشتريات، مصاريف، تحصيل) يعود إليها، والربح الفعلي يُحسب عند إغلاقها مالياً.",
  "التسعير: لكل صنف سعر تكلفة وسعر بيع منفصلان. أسعار المناسبة تستخدم لقطات سعرية (Snapshots)؛ تغيير سعر كتالوج لاحقاً لا يُعاد تسعير المناسبات التاريخية أبداً.",
  "الباقات قوالب للمشاريع؛ أسطر المناسبة لقطات خاصة بالمناسبة، فلا يجعل باقة المناسبات التاريخية معتمدة على حالة القالب.",
  "التكلفة الفعلية يتم احتسابها من المصاريف والمشتريات (الموردون والمواد) عند المناسبة، ويُقارن بها الإيراد لحساب إجمالي الربح المتبقي وهامش الربح.",
  "التجهيز والجاهزية: تُقيّم المناسبة عبر جاهزية تشغيلية (طاقم/معدات/مواد/مشتريات بعيداً عن النقود) وجاهزية مالية (الأموال تُبعد عن READY حتى لا تُغطي نقصاً تشغيلياً).",
  "التحصيل: سند قبض يُسجل عند الدفع، وله حساب كشف حساب للعميل؛ المتبقي (Outstanding) هو أصل متابعة، ومعرفته مبكراً تحمي التدفق النقدي.",
  "في النقد: المبالغ تُدار بالملي-ريال (1 ريال=1000) وتُعرض بتقريب 3 خانات عشرية؛ لا تُنفّذ القيمة العائمة كقيمة محفوظة نهائية.",
  "المخزن: المعدات القابلة لإعادة الاستخدام والمواد الاستهلاكية دلالتان مختلفتان ولا تُنمذجان بنفس الطريقة، والعمليات تدقيقية.",
  "العملات والدول لمساحة العمل: الريال العماني (OMR) — وهي العملة الأساسية لكل الحسابات، والدولة المستهدفة سلطنة عُمان.",
  "مستوى الخدمة: بساطة الواجهة متطلب منتج (مالك 50+ عاماً)؛ القرارات تصل من الواجهة دون تمويه ولا وحدات وهمية.",
].join("\n");

/** @internal Rendered KB for model injection. */
export function renderHospitalityKbText(): string {
  return HOSPITALITY_KB;
}
