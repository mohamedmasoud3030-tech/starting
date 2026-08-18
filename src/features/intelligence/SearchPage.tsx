import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { useGlobalSearch } from "./intelligence.api";

const ENTITY_LABEL: Record<string, string> = {
  customer: "عميل",
  event: "مناسبة",
  quote: "عرض سعر",
  invoice: "فاتورة",
};

/**
 * Practical global search (E5): organization-scoped, server-side (bounded
 * LIMIT per entity), results grouped by entity type and opening the right
 * workspace directly.
 */
export function SearchPage() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const [term, setTerm] = useState("");
  const results = useGlobalSearch(orgId, term);

  const grouped = (results.data ?? []).reduce<Record<string, typeof results.data>>(
    (acc, r) => {
      (acc[r.entity_type] ??= []).push(r);
      return acc;
    },
    {},
  );

  return (
    <div>
      <PageHeader title="البحث" description="ابحث في العملاء، المناسبات، عروض الأسعار والفواتير" />

      <label className="relative block">
        <span className="sr-only">البحث</span>
        <Search className="pointer-events-none absolute right-3 top-3.5 h-5 w-5 text-slate-400" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="اسم العميل، الهاتف، رقم المناسبة، رقم العرض أو الفاتورة…"
          className="min-h-12 w-full rounded-xl border border-slate-200 bg-white pr-10 pl-3 text-base outline-none focus:border-brand-500"
          autoFocus
        />
      </label>

      {term.trim().length >= 2 && (
        <div className="mt-4 space-y-4">
          {results.isLoading ? (
            <p className="text-slate-500">جارٍ البحث…</p>
          ) : (results.data ?? []).length === 0 ? (
            <p className="text-slate-500">لا توجد نتائج مطابقة.</p>
          ) : (
            Object.entries(grouped).map(([type, rows]) => (
              <section key={type}>
                <h2 className="mb-2 text-sm font-bold text-slate-400">{ENTITY_LABEL[type] ?? type}</h2>
                <ul className="space-y-2">
                  {(rows ?? []).map((r) => (
                    <li key={`${r.entity_type}-${r.entity_id}`}>
                      <Link to={r.destination} className="block">
                        <Card className="flex items-center justify-between gap-3 p-3 hover:border-brand-300">
                          <div className="min-w-0">
                            <p className="truncate font-bold">{r.title}</p>
                            {r.subtitle && <p className="truncate text-sm text-slate-500">{r.subtitle}</p>}
                          </div>
                          <span className="shrink-0 text-sm font-bold text-brand-700">{ENTITY_LABEL[type]}</span>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
