import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileText, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatOMR, fromDbAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  arabicQuickQuoteError,
  useDiscardQuickQuote,
  useQuickQuotes,
  type QuickQuoteStatus,
} from "./quotes.api";

const STATUS_LABELS: Record<QuickQuoteStatus, string> = {
  DRAFT: "مسودة",
  ISSUED: "صادر",
  ACCEPTED: "معتمد",
  CONVERTED: "محوّل لمناسبة",
  DISCARDED: "ملغي",
};

const STATUS_TONES: Record<QuickQuoteStatus, "neutral" | "success" | "warning" | "danger" | "brand"> = {
  DRAFT: "neutral",
  ISSUED: "warning",
  ACCEPTED: "success",
  CONVERTED: "brand",
  DISCARDED: "danger",
};

export function QuotesPage() {
  const { currentOrganization, canManageCommercial } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const quotes = useQuickQuotes(orgId);
  const discard = useDiscardQuickQuote(orgId);
  const navigate = useNavigate();
  const [discarding, setDiscarding] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState("");

  if (!canManageCommercial) {
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
      setError(arabicQuickQuoteError(x));
    }
  }

  return (
    <div>
      <PageHeader
        title="عروض الأسعار السريعة"
        description="اعمل عرض سعر بسرعة دون الحاجة لتسجيل عميل أو إنشاء مناسبة أولاً"
        actions={
          <Button size="lg" onClick={() => void navigate({ to: "/quotes/new" })}>
            <Plus className="h-5 w-5" />
            عرض سعر جديد
          </Button>
        }
      />

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 font-bold text-red-700">
          {error}
        </p>
      )}

      {quotes.isLoading ? (
        <p>جارٍ التحميل…</p>
      ) : !quotes.data?.length ? (
        <EmptyState
          title="لا توجد عروض أسعار"
          description="ابدأ عرض سعر جديد من زر «عرض سعر جديد»."
          action={
            <Button onClick={() => void navigate({ to: "/quotes/new" })}>
              + عرض سعر جديد
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {quotes.data.map((q) => (
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
                      <h2 className="mt-1 text-lg font-bold">{q.prospect_name}</h2>
                      {q.prospect_company && (
                        <p className="text-sm text-slate-500">{q.prospect_company}</p>
                      )}
                    </div>
                    <Badge tone={STATUS_TONES[q.status]}>{STATUS_LABELS[q.status]}</Badge>
                  </div>
                  <div className="mt-4 space-y-1 text-sm text-slate-600">
                    {q.venue_name && <p>📍 {q.venue_name}</p>}
                    {q.start_at && (
                      <p>
                        {new Date(q.start_at).toLocaleString("ar-OM", {
                          timeZone: "Asia/Muscat",
                        })}
                      </p>
                    )}
                    {q.guest_count != null && <p>{q.guest_count} ضيف</p>}
                  </div>
                  {q.total_selling != null && (
                    <p className="mt-3 border-t border-slate-100 pt-3 text-lg font-black text-slate-900">
                      {formatOMR(fromDbAmount(q.total_selling))}
                    </p>
                  )}
                </Card>
              </Link>
              {q.status === "DRAFT" && (
                <div className="mt-1 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDiscarding({ id: q.id, name: q.prospect_name })}
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف المسودة
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
        title="حذف المسودة"
        description={`سيتم حذف مسودة عرض السعر للعميل «${discarding?.name ?? ""}». لن يتم إنشاء عميل أو مناسبة.`}
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
