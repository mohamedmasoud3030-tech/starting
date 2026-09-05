import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { useIntegrityFindings } from "./intelligence.api";

const CATEGORY_LABEL: Record<string, string> = {
  commercial: "سلامة تجارية",
  financial: "سلامة مالية",
  operational: "سلامة تشغيلية",
};

/**
 * Integrity Center (E6). Surfaces data states that "should not exist", with
 * severity, why it matters, and a direct link. Detection only — never auto-fix.
 */
export function IntegrityCenter() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const findings = useIntegrityFindings(orgId);

  return (
    <div>
      <PageHeader
        title="مركز السلامة"
        description="حالات بيانات يُفترض ألا توجد — تُكشف هنا ولا تُصلَّح تلقائياً"
      />

      {findings.isLoading ? (
        <Card className="p-4 text-slate-500">جارٍ الفحص…</Card>
      ) : findings.error ? (
        <ErrorState
          title="تعذّر فحص سلامة البيانات"
          message="حدث خطأ أثناء فحص سلامة البيانات. أعد المحاولة."
          onRetry={() => void findings.refetch()}
        />
      ) : (findings.data ?? []).length === 0 ? (
        <Card className="flex items-center gap-3 border-emerald-200 bg-emerald-50 p-5 text-emerald-800">
          <ShieldAlert className="h-6 w-6" />
          <p className="font-bold">لم تُكتشف أي مخالفات في سلامة البيانات.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {(findings.data ?? []).map((f) => (
            <li key={`${f.finding_code}-${f.entity_id}`}>
              <Card className="p-4">
                <div className="flex items-start gap-3">
                  <Badge tone="danger" className="mt-0.5 shrink-0">
                    {CATEGORY_LABEL[f.category] ?? f.category}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="font-black">{f.problem}</p>
                    <p className="mt-1 text-sm text-slate-500">{f.why_it_matters}</p>
                    <p className="mt-1 text-xs font-mono text-slate-400" dir="ltr">
                      {f.finding_code}
                    </p>
                  </div>
                  <Link
                    to={f.destination}
                    className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-brand-700 hover:border-brand-300"
                  >
                    فحص
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
