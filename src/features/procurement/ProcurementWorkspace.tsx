import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ClipboardList, Truck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import type {
  ProcurementAccess,
  ProcurementDataSource,
  ProcurementEventOption,
} from "./contracts";
import { procurementErrorMessage } from "./errors";
import { OrdersArea } from "./OrdersArea";
import { SuppliersArea } from "./SuppliersArea";

/**
 * Page-level S5B operator workspace. It cannot run without a real adapter;
 * there is intentionally no demo or in-memory production fallback.
 */
export function ProcurementWorkspace({
  dataSource,
  events = [],
}: {
  dataSource: ProcurementDataSource;
  events?: ProcurementEventOption[];
}) {
  const [access, setAccess] = useState<ProcurementAccess | null>(null);
  const [tab, setTab] = useState<"orders" | "suppliers">("orders");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const ordersTabRef = useRef<HTMLButtonElement>(null);
  const suppliersTabRef = useRef<HTMLButtonElement>(null);

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    let next: "orders" | "suppliers" | null = null;
    if (event.key === "Home") next = "orders";
    if (event.key === "End") next = "suppliers";
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      next = tab === "orders" ? "suppliers" : "orders";
    }
    if (!next) return;
    event.preventDefault();
    setTab(next);
    (next === "orders" ? ordersTabRef : suppliersTabRef).current?.focus();
  }

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void dataSource.getAccess().then(
      (value) => { if (current) setAccess(value); },
      (cause) => { if (current) setError(procurementErrorMessage(cause)); },
    ).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [dataSource, reload]);

  if (loading) {
    return <div className="flex min-h-72 items-center justify-center gap-3" aria-busy="true"><Spinner className="h-8 w-8" /><span className="text-lg font-bold text-slate-600">جارٍ تحميل المشتريات…</span></div>;
  }
  if (error || !access) {
    return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"><h1 className="text-xl font-black">تعذر فتح المشتريات</h1><p className="mt-1 font-semibold">{error || "تعذر التحقق من صلاحيات الوصول."}</p><Button variant="outline" className="mt-4" onClick={() => setReload((value) => value + 1)}>إعادة المحاولة</Button></div>;
  }

  return (
    <main className="space-y-5" aria-labelledby="procurement-title">
      <header><h1 id="procurement-title" className="text-3xl font-black">الموردون والمشتريات</h1><p className="mt-1 text-lg text-slate-600">إدارة الموردين وطلبات التوريد والاستلام من مكان واحد.</p></header>
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1" role="tablist" aria-label="أقسام المشتريات">
        <button ref={ordersTabRef} type="button" role="tab" id="procurement-tab-orders" aria-controls="procurement-panel" aria-selected={tab === "orders"} tabIndex={tab === "orders" ? 0 : -1} onKeyDown={handleTabKey} onClick={() => setTab("orders")} className={`flex min-h-14 items-center justify-center gap-2 rounded-xl px-3 text-base font-black transition-colors ${tab === "orders" ? "bg-white text-brand-800 shadow-sm" : "text-slate-600 hover:bg-white/60"}`}><ClipboardList aria-hidden="true" />الطلبات</button>
        <button ref={suppliersTabRef} type="button" role="tab" id="procurement-tab-suppliers" aria-controls="procurement-panel" aria-selected={tab === "suppliers"} tabIndex={tab === "suppliers" ? 0 : -1} onKeyDown={handleTabKey} onClick={() => setTab("suppliers")} className={`flex min-h-14 items-center justify-center gap-2 rounded-xl px-3 text-base font-black transition-colors ${tab === "suppliers" ? "bg-white text-brand-800 shadow-sm" : "text-slate-600 hover:bg-white/60"}`}><Truck aria-hidden="true" />الموردون</button>
      </div>
      <div id="procurement-panel" role="tabpanel" aria-labelledby={`procurement-tab-${tab}`} tabIndex={0}>
        {tab === "orders" ? <OrdersArea dataSource={dataSource} access={access} events={events} /> : <SuppliersArea dataSource={dataSource} access={access} />}
      </div>
    </main>
  );
}
