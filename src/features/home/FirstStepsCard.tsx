import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/Card";

const FIRST_STEPS: ReadonlyArray<{
  step: string;
  title: string;
  detail: string;
  to: "/quotes/new" | "/quotes" | "/events";
}> = [
  {
    step: "١",
    title: "أنشئ عرض سعر",
    detail: "اكتب الخدمات والأسعار كما تريد — بلا باقة إلزامية.",
    to: "/quotes/new",
  },
  {
    step: "٢",
    title: "أصدره وأعطه للعميل",
    detail: "اطبع العرض أو احفظه PDF بعد الإصدار.",
    to: "/quotes",
  },
  {
    step: "٣",
    title: "اعتمد ثم حوّل إلى مناسبة",
    detail: "بعد موافقة العميل يصبح العرض حجزاً للتنفيذ.",
    to: "/quotes",
  },
  {
    step: "٤",
    title: "نفّذ، حصّل، ثم أغلق لتعرف الربح",
    detail: "الإيراد والتحصيل والمصروف أرقام منفصلة بعد الإغلاق.",
    to: "/events",
  },
];

/**
 * First-minutes path for a new office: quote → issue → accept/convert →
 * execute/collect/close. Catalog and packages are optional, not the start.
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
            المسار الصحيح: عرض سعر ← اعتماد ← مناسبة ← تنفيذ ← تحصيل ← ربح.
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
