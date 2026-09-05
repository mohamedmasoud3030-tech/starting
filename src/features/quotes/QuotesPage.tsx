import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileText, Plus, Search, XCircle } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { InlineError } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { JobPath } from "@/components/ui/JobPath";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  arabicQuotationError,
  useCancelQuotationDraft,
  useQuotations,
  type QuotationStatus,
} from "./quotes.api";

const STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: "مسودة",
  ISSUED: "مُرسل",
  EXPIRED: "منتهي الصلاحية",
  ACCEPTED: "معتمد",
  REJECTED: "مرفوض",
  CONVERTED: "محوّل لمناسبة",
  CANCELLED: "ملغي",
  SUPERSEDED: "مستبدل",
};

const STATUS_TONES: Record<QuotationStatus, "neutral" | "success" | "warning" | "danger" | "brand"> = {
  DRAFT: "neutral",
  ISSUED: "warning",
  EXPIRED: "neutral",
  ACCEPTED: "success",
  REJECTED: "danger",
  CONVERTED: "brand",
  CANCELLED: "danger",
  SUPERSEDED: "neutral",
};

export function QuotesPage() {
  const {
    currentOrganization,
    canManageCommercial,
    canIssueQuotation,
  } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const quotes = useQuotations(orgId);
  const discard = useCancelQuotationDraft(orgId);
  const navigate = useNavigate();
  const [discarding, setDiscarding] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuotationStatus | "ALL">("ALL");
  const visibleQuotes = (quotes.data ?? []).filter((quote) => {
    const term = search.trim().toLocaleLowerCase("ar");
    const matchesStatus = statusFilter === "ALL" || quote.status === statusFilter;
    const haystack = `${quote.quotation_number ?? ""} ${quote.customer_name_snapshot} ${quote.prospect_company ?? ""} ${quote.venue_snapshot ?? ""}`.toLocaleLowerCase("ar");
    return matchesStatus && (!term || haystack.includes(term));
  });

  // Entry: managing (drafts) or issuing (accept/convert) both have work here.
  if (!canManageCommercial && !canIssueQuotation) {
    return (
      <p className="rounded-xl bg-amber-50 p-4 font-bold text-amber-800">
        عروض الأسعار متاحة للمالك والمدير فقط.
      </p>
    );
  }

  async function confirmDiscard() {
    if (!discarding) return;
    setError("");
    try {
      await discard.mutateAsync(discarding.id);
      setDiscarding(null);
    } catch (x) {
      setError(arabicQuotationError(x));
    }
  }

  return (
    <div>
      <PageHeader
        title="عروض الأسعار"
        description="ابدأ من هنا: أنشئ عرضاً، أصدره للعميل، اعتمده بعد الموافقة، ثم حوّله إلى مناسبة"
        actions={
          // create_quotation_draft → quotation.manage
          canManageCommercial ? (
            <Button size="lg" onClick={() => void navigate({ to: "/quotes/new" })}>
              <Plus className="h-5 w-5" />
              عرض سعر جديد
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5">
        <JobPath current="quote" />
      </div>

      {error && (
        <InlineError message={error} className="mb-4" />
      )}

      <div className="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <label className="relative block">
          <span className="sr-only">البحث في عروض الأسعار</span>
          <Search className="pointer-events-none absolute right-3 top-3.5 h-5 w-5 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث بالرقم، العميل أو الموقع"
            aria-label="البحث في عروض الأسعار"
            className="pr-10"
          />
        </label>
        <SegmentedControl<QuotationStatus | "ALL">
          ariaLabel="تصفية حالة العرض"
          className="overflow-x-auto"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "ALL", label: "الكل" },
            { value: "DRAFT", label: "المسودات" },
            { value: "ISSUED", label: "المرسلة" },
            { value: "ACCEPTED", label: "المعتمدة" },
            { value: "REJECTED", label: "المرفوضة" },
            { value: "CONVERTED", label: "المحوّلة" },
          ]}
        />
      </div>

      {quotes.isLoading ? (
        <LoadingState full label="جارٍ تحميل عروض الأسعار…" />
      ) : quotes.error ? (
        <ErrorState
          title="تعذّر تحميل عروض الأسعار"
          message="حدث خطأ أثناء تحميل عروض الأسعار. أعد المحاولة."
          onRetry={() => void quotes.refetch()}
        />
      ) : !quotes.data?.length ? (
        <EmptyState
          title="لا توجد عروض أسعار"
          description="ابدأ عرض سعر جديد من زر «عرض سعر جديد»."
          action={
            canManageCommercial ? (
              <Button onClick={() => void navigate({ to: "/quotes/new" })}>
                + عرض سعر جديد
              </Button>
            ) : undefined
          }
        />
      ) : visibleQuotes.length === 0 ? (
        <EmptyState title="لا توجد نتائج مطابقة" description="غيّر عبارة البحث أو حالة العرض." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visibleQuotes.map((q) => (
            <div key={q.id}>
              <Link
                to="/quotes/$quoteId"
                params={{ quoteId: q.id }}
                className="block h-full text-right"
              >
                <Card
                  className={cn(
                    "h-full p-5 transition hover:border-brand-300",
                    q.status === "DRAFT" && "border-dashed",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm text-slate-500" dir="ltr">
                        {q.quotation_number ?? "مسودة"}
                      </p>
                      <h2 className="mt-1 text-lg font-bold">{q.customer_name_snapshot}</h2>
                      {q.prospect_company && (
                        <p className="text-sm text-slate-500">{q.prospect_company}</p>
                      )}
                    </div>
                    <Badge tone={STATUS_TONES[q.status]}>{STATUS_LABELS[q.status]}</Badge>
                  </div>
                  <div className="mt-4 space-y-1 text-sm text-slate-600">
                    {q.venue_snapshot && <p>📍 {q.venue_snapshot}</p>}
                    {q.start_at_snapshot && (
                      <p>
                        {new Date(q.start_at_snapshot).toLocaleString("ar-OM", {
                          timeZone: "Asia/Muscat",
                        })}
                      </p>
                    )}
                    {q.guest_count_snapshot != null && <p>{q.guest_count_snapshot} ضيف</p>}
                  </div>
                  {q.total_selling != null && (
                    <p className="mt-3 border-t border-slate-100 pt-3 text-lg font-black text-slate-900">
                      {formatOMR(fromDbAmount(q.total_selling))}
                    </p>
                  )}
                </Card>
              </Link>
              {/* cancel_quotation_draft → quotation.manage */}
              {q.status === "DRAFT" && canManageCommercial && (
                <div className="mt-1 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDiscarding({ id: q.id, name: q.customer_name_snapshot })}
                  >
                    <XCircle className="h-4 w-4" />
                    إلغاء المسودة
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={discarding !== null}
        onOpenChange={(open) => {
          if (!open) setDiscarding(null);
        }}
        title="إلغاء المسودة"
        description={`سيتم إلغاء مسودة عرض السعر للعميل «${discarding?.name ?? ""}». لن يتم إنشاء عميل أو مناسبة.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDiscarding(null)}>
            إلغاء
          </Button>
          <Button variant="danger" onClick={() => void confirmDiscard()}>
            حذف
          </Button>
        </div>
      </Dialog>

      <p className="mt-6 flex items-center gap-2 text-sm text-slate-500">
        <FileText className="h-4 w-4" />
        عرض السعر يصبح نهائياً عند الإصدار ولا يمكن تعديله بعدها.
      </p>
    </div>
  );
}
