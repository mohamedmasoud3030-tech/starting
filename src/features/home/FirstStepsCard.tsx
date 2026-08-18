import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/Card";

const FIRST_STEPS: ReadonlyArray<{
  step: string;
  title: string;
  detail: string;
  to: "/catalog" | "/customers" | "/quotes" | "/events";
}> = [
  {
    step: "١",
    title: "جهّز دليل الخدمات والأسعار",
    detail: "أضف الخدمات والمعدات والمواد التي تقدّمها مع أسعار البيع.",
    to: "/catalog",
  },
  {
    step: "٢",
    title: "أضف أول عميل",
    detail: "سجّل عميلاً لتبدأ منه عروض الأسعار والمناسبات.",
    to: "/customers",
  },
  {
    step: "٣",
    title: "أنشئ عرض سعر",
    detail: "قدّم عرضاً لعميلك واعتمده بعد موافقته.",
    to: "/quotes",
  },
  {
    step: "٤",
    title: "حوّل العرض إلى مناسبة",
    detail: "بعد القبول تصبح المناسبة جاهزة للتنفيذ والإغلاق بالربح.",
    to: "/events",
  },
];

/**
 * First-minutes onboarding shown only when the workspace has no events and no
 * customers yet. It turns a dashboard of zeros into an ordered starting path
 * that mirrors the real dependency chain (catalog → customer → quotation →
 * event).
 */
export function FirstStepsCard() {
  return (
    <Card className="border-brand-200 bg-brand-50/60 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-xl font-bold text-white">
          ١
        </div>
        <div>
          <h2 className="text-lg font-black text-slate-900">ابدأ من هنا</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            لم تُسجَّل بيانات بعد. أكمل هذه الخطوات بالترتيب لبدء استخدام
            النظام.
          </p>
        </div>
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {FIRST_STEPS.map((item) => (
          <li key={item.title}>
            <Link
              to={item.to}
              className="group flex h-full items-start gap-3 rounded-xl border border-brand-100 bg-white p-3 transition-colors hover:border-brand-300"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-base font-black text-brand-800">
                {item.step}
              </span>
              <span>
                <span className="block font-bold text-slate-900 group-hover:text-brand-800">
                  {item.title}
                </span>
                <span className="mt-0.5 block text-sm leading-5 text-slate-500">
                  {item.detail}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
