import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Calculator, Package, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { usePackages } from "@/features/packages/packages.api";
import { useCatalogItems } from "@/features/catalog/catalog.api";
import { ITEM_TYPE_LABELS, PRICING_METHOD_LABELS } from "@/lib/domain";
import type { CatalogItemType, PricingMethod } from "@/lib/dbTypes";
import {
  formatOMR,
  fromDbAmount,
  parseOMR,
  parseQuantityMilli,
  toOMRString,
  type MilliOMR,
} from "@/lib/money";
import {
  arabicQuickQuoteError,
  useCreateQuickQuote,
  useDiscardQuickQuote,
  useIssueQuickQuote,
  useQuickQuote,
  useQuickQuoteLines,
  useResetQuickQuoteLines,
  useSaveQuickQuoteLine,
  type QuickQuoteDraftValues,
} from "./quotes.api";
import { computeQuickLineTotalMilli, sumQuickLineTotals } from "./quoteMath";

const ITEM_TYPES = Object.keys(ITEM_TYPE_LABELS) as CatalogItemType[];
const PRICING_METHODS = Object.keys(PRICING_METHOD_LABELS) as PricingMethod[];

interface DraftLine {
  clientKey: string;
  id: string | null; // server id once persisted (edit mode)
  description: string;
  itemType: CatalogItemType;
  unit: string;
  pricingMethod: PricingMethod;
  quantity: string;
  unitSellingPrice: string;
  isCustom: boolean;
}

interface DraftForm {
  prospectName: string;
  prospectPhone: string;
  prospectWhatsapp: string;
  prospectCompany: string;
  eventTitle: string;
  eventType: string;
  startAt: string;
  endAt: string;
  venueName: string;
  notes: string;
}

function emptyForm(): DraftForm {
  return {
    prospectName: "",
    prospectPhone: "",
    prospectWhatsapp: "",
    prospectCompany: "",
    eventTitle: "",
    eventType: "",
    startAt: "",
    endAt: "",
    venueName: "",
    notes: "",
  };
}

function toDraftValues(form: DraftForm, guestCount: number | null): QuickQuoteDraftValues {
  return { ...form, guestCount };
}

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

let lineCounter = 0;

export function QuickQuoteWorkspace({ draftId }: { draftId?: string }) {
  const { currentOrganization, canManageCommercial } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const navigate = useNavigate();

  const existing = useQuickQuote(orgId, draftId ?? "");
  const existingLines = useQuickQuoteLines(orgId, draftId ?? "");
  const packages = usePackages(orgId);
  const catalog = useCatalogItems(orgId);

  const createDraft = useCreateQuickQuote(orgId);
  const saveLine = useSaveQuickQuoteLine(orgId);
  const resetLines = useResetQuickQuoteLines(orgId);
  const issue = useIssueQuickQuote(orgId);
  const discard = useDiscardQuickQuote(orgId);

  const [form, setForm] = useState<DraftForm>(emptyForm);
  const [guestCount, setGuestCount] = useState("");
  const [savedDraftId, setSavedDraftId] = useState<string | null>(draftId ?? null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  // Edit mode: hydrate from the persisted draft.
  useEffect(() => {
    if (draftId && existing.data) {
      setForm({
        prospectName: existing.data.prospect_name,
        prospectPhone: existing.data.prospect_phone ?? "",
        prospectWhatsapp: existing.data.prospect_whatsapp ?? "",
        prospectCompany: existing.data.prospect_company ?? "",
        eventTitle: existing.data.event_title ?? "",
        eventType: existing.data.event_type ?? "",
        startAt: isoToLocalInput(existing.data.start_at),
        endAt: isoToLocalInput(existing.data.end_at),
        venueName: existing.data.venue_name ?? "",
        notes: existing.data.notes ?? "",
      });
      setGuestCount(existing.data.guest_count != null ? String(existing.data.guest_count) : "");
    }
  }, [draftId, existing.data]);

  useEffect(() => {
    if (draftId && existingLines.data) {
      setLines(
        existingLines.data.map((l) => ({
          clientKey: `server-${l.id}`,
          id: l.id,
          description: l.description,
          itemType: l.item_type,
          unit: l.unit,
          pricingMethod: l.pricing_method,
          quantity: l.quantity,
          unitSellingPrice: l.unit_selling_price,
          isCustom: l.is_custom,
        })),
      );
    }
  }, [draftId, existingLines.data]);

  const guestCountNum = guestCount.trim() === "" ? null : Number(guestCount);

  // Hooks must run unconditionally, before any early return.
  const lineTotals = useMemo<Array<MilliOMR | null>>(
    () =>
      lines.map((l) =>
        computeQuickLineTotalMilli(
          l.pricingMethod,
          parseOMR(l.unitSellingPrice),
          parseQuantityMilli(l.quantity),
          guestCountNum,
        ),
      ),
    [lines, guestCountNum],
  );
  const grandTotalMilli = useMemo(() => sumQuickLineTotals(lineTotals), [lineTotals]);
  const pricingBlocked = useMemo(
    () => lines.some((l, i) => l.pricingMethod === "PER_GUEST" && lineTotals[i] === null),
    [lines, lineTotals],
  );

  if (!canManageCommercial) {
    return (
      <p className="rounded-xl bg-amber-50 p-4 font-bold text-amber-800">
        عروض الأسعار متاحة للمالك والمدير فقط.
      </p>
    );
  }

  async function ensureDraft(): Promise<string> {
    if (savedDraftId) return savedDraftId;
    const draft = await createDraft.mutateAsync(toDraftValues(form, guestCountNum));
    setSavedDraftId(draft.id);
    return draft.id;
  }

  function setField<K extends keyof DraftForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addCustomLine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const description = String(f.get("description") ?? "").trim();
    const quantity = String(f.get("quantity") ?? "");
    const price = String(f.get("price") ?? "");
    if (!description || !quantity || !price) {
      setError("أكمل وصف الخدمة والكمية والسعر");
      return;
    }
    lineCounter += 1;
    setLines((ls) => [
      ...ls,
      {
        clientKey: `line-${lineCounter}`,
        id: null,
        description,
        itemType: String(f.get("itemType")) as CatalogItemType,
        unit: String(f.get("unit") ?? "وحدة").trim() || "وحدة",
        pricingMethod: String(f.get("pricingMethod")) as PricingMethod,
        quantity,
        unitSellingPrice: price,
        isCustom: true,
      },
    ]);
    e.currentTarget.reset();
  }

  function applySelectedPackage() {
    setError("");
    if (!selectedPackage) {
      setError("اختر الباقة أولاً");
      return;
    }
    const pkg = packages.data?.find((p) => p.package.id === selectedPackage);
    if (!pkg || pkg.lines.length === 0) {
      setError("الباقة لا تحتوي على خدمات");
      return;
    }
    const catalogById = new Map(catalog.data?.map((c) => [c.id, c]) ?? []);
    const missing = pkg.lines.some((l) => !catalogById.has(l.catalog_item_id));
    if (missing) {
      setError("تعذر تحميل تفاصيل بعض خدمات الباقة");
      return;
    }
    const added: DraftLine[] = pkg.lines.map((l) => {
      const item = catalogById.get(l.catalog_item_id)!;
      lineCounter += 1;
      return {
        clientKey: `line-${lineCounter}`,
        id: null,
        description: item.name,
        itemType: item.item_type,
        unit: item.unit,
        pricingMethod: item.pricing_method,
        // `DraftLine` holds editable decimal TEXT. The package line quantity
        // and catalog selling price arrive in the database numeric transport
        // shape, so they are normalized through exact milli-OMR before being
        // rendered as text — never via float formatting.
        quantity: toOMRString(fromDbAmount(l.quantity)),
        unitSellingPrice: toOMRString(fromDbAmount(item.selling_price)),
        isCustom: false,
      };
    });
    setLines((ls) => [...ls, ...added]);
    setSelectedPackage("");
  }

  function removeLine(clientKey: string) {
    setLines((ls) => ls.filter((l) => l.clientKey !== clientKey));
  }

  async function onDiscard() {
    setError("");
    if (!savedDraftId) return;
    setBusy("حذف");
    try {
      await discard.mutateAsync(savedDraftId);
      await navigate({ to: "/quotes" });
    } catch (x) {
      setError(arabicQuickQuoteError(x));
      setBusy("");
    }
  }

  async function onIssue() {
    setError("");
    if (lines.length === 0) {
      setError("أضف خدمة واحدة على الأقل قبل الإصدار");
      return;
    }
    setBusy("الإصدار");
    try {
      const id = await ensureDraft();
      // Replace any previously persisted draft lines with the current set
      // (a no-op on a brand-new draft). Keeps retries duplicate-free.
      await resetLines.mutateAsync(id);
      for (const line of lines) {
        await saveLine.mutateAsync({
          quickQuoteId: id,
          lineId: null,
          description: line.description,
          itemType: line.itemType,
          unit: line.unit,
          pricingMethod: line.pricingMethod,
          quantity: line.quantity,
          unitSellingPrice: line.unitSellingPrice,
          isCustom: line.isCustom,
        });
      }
      const quote = await issue.mutateAsync(id);
      await navigate({ to: "/quotes/$quoteId", params: { quoteId: id } });
      void quote;
    } catch (x) {
      setError(arabicQuickQuoteError(x));
      setBusy("");
    }
  }

  if (draftId && existing.isLoading) return <p>جارٍ التحميل…</p>;
  if (draftId && existing.data?.status !== "DRAFT") {
    return (
      <p className="rounded-xl bg-amber-50 p-4 font-bold text-amber-800">
        هذا العرض صادر أو محوّل ولا يمكن تعديله.
      </p>
    );
  }

  return (
    <div>
      <PageHeader
        title={draftId ? "تعديل عرض السعر" : "عرض سعر جديد"}
        description="اعمل عرض سعر بسرعة — بدون الحاجة لتسجيل عميل أو إنشاء مناسبة"
      />
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 font-bold text-red-700">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* -------------------------------------------------- Step 1 */}
          <Card className="p-5">
            <h2 className="mb-1 text-xl font-black">
              <span className="text-brand-700">١.</span> بيانات بسيطة
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              كل الحقول اختيارية عدا اسم العميل المتوقع.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم العميل / المتوقع *" htmlFor="qq-prospect-name">
                <Input
                  id="qq-prospect-name"
                  value={form.prospectName}
                  onChange={(e) => setField("prospectName", e.target.value)}
                  placeholder="مثال: محمد"
                  required
                />
              </Field>
              <Field label="رقم الجوال" htmlFor="qq-prospect-phone">
                <Input
                  id="qq-prospect-phone"
                  value={form.prospectPhone}
                  onChange={(e) => setField("prospectPhone", e.target.value)}
                  inputMode="tel"
                  dir="ltr"
                />
              </Field>
              <Field label="واتساب (إن اختلف)" htmlFor="qq-whatsapp">
                <Input
                  id="qq-whatsapp"
                  value={form.prospectWhatsapp}
                  onChange={(e) => setField("prospectWhatsapp", e.target.value)}
                  inputMode="tel"
                  dir="ltr"
                />
              </Field>
              <Field label="اسم الشركة / الجهة (اختياري)" htmlFor="qq-company">
                <Input
                  id="qq-company"
                  value={form.prospectCompany}
                  onChange={(e) => setField("prospectCompany", e.target.value)}
                />
              </Field>
              <Field label="اسم المناسبة (اختياري)" htmlFor="qq-event-title">
                <Input
                  id="qq-event-title"
                  value={form.eventTitle}
                  onChange={(e) => setField("eventTitle", e.target.value)}
                  placeholder="زفاف، مؤتمر…"
                />
              </Field>
              <Field label="تاريخ البداية (إن معروف)" htmlFor="qq-start">
                <Input
                  id="qq-start"
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setField("startAt", e.target.value)}
                />
              </Field>
              <Field label="تاريخ النهاية (إن معروف)" htmlFor="qq-end">
                <Input
                  id="qq-end"
                  type="datetime-local"
                  value={form.endAt}
                  onChange={(e) => setField("endAt", e.target.value)}
                />
              </Field>
              <Field label="الموقع / القاعة (إن معروف)" htmlFor="qq-venue">
                <Input
                  id="qq-venue"
                  value={form.venueName}
                  onChange={(e) => setField("venueName", e.target.value)}
                  placeholder="قاعة الريان"
                />
              </Field>
              <Field label="عدد الضيوف (إن معروف)" htmlFor="qq-guests">
                <Input
                  id="qq-guests"
                  type="number"
                  min="1"
                  value={guestCount}
                  onChange={(e) => setGuestCount(e.target.value)}
                  placeholder="120"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="ملاحظات" htmlFor="qq-notes">
                  <Textarea id="qq-notes" value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
                </Field>
              </div>
            </div>
          </Card>

          {/* -------------------------------------------------- Step 2 */}
          <Card id="quick-quote-services" className="scroll-mt-24 p-5">
            <h2 className="mb-1 text-xl font-black">
              <span className="text-brand-700">٢.</span> الخدمات والسعر
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              أضف خدمات من باقة جاهزة أو أضف خدمة يدوياً. الإجمالي يتحدث مباشرة.
            </p>

            <div className="mb-4 flex flex-wrap items-end gap-2">
              <div className="min-w-52 flex-1">
                <Field label="باقة جاهزة" htmlFor="qq-package">
                  <Select
                    id="qq-package"
                    value={selectedPackage}
                    onChange={(e) => setSelectedPackage(e.target.value)}
                  >
                    <option value="">اختر الباقة…</option>
                    {packages.data
                      ?.filter((p) => p.package.status === "ACTIVE")
                      .map((p) => (
                        <option key={p.package.id} value={p.package.id}>
                          {p.package.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              </div>
              <Button variant="secondary" onClick={applySelectedPackage}>
                <Package className="h-5 w-5" />
                تطبيق الباقة
              </Button>
            </div>

            <form className="grid gap-3 sm:grid-cols-6" onSubmit={addCustomLine}>
              <div className="sm:col-span-3">
                <Field label="الوصف" htmlFor="line-description">
                  <Input id="line-description" name="description" placeholder="مثال: طاولة ملكية" />
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field label="النوع" htmlFor="line-item-type">
                  <Select id="line-item-type" name="itemType" defaultValue="SERVICE">
                    {ITEM_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {ITEM_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field label="الوحدة" htmlFor="line-unit">
                  <Input id="line-unit" name="unit" placeholder="وحدة" />
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field label="طريقة التسعير" htmlFor="line-pricing-method">
                  <Select id="line-pricing-method" name="pricingMethod" defaultValue="FIXED">
                    {PRICING_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PRICING_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="الكمية" htmlFor="line-quantity">
                  <Input id="line-quantity" name="quantity" type="number" min="0.001" step="0.001" placeholder="1" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="سعر الوحدة (ر.ع.)" htmlFor="line-price">
                  <Input id="line-price" name="price" type="number" min="0" step="0.001" placeholder="50.000" />
                </Field>
              </div>
              <div className="sm:col-span-2 flex items-end">
                <Button type="submit">
                  <Plus className="h-5 w-5" />
                  إضافة خدمة
                </Button>
              </div>
            </form>

            <div className="mt-4 space-y-2">
              {lines.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-4 text-center text-slate-500">
                  لا توجد خدمات بعد.
                </p>
              ) : (
                lines.map((line, index) => {
                  const total = lineTotals[index];
                  return (
                    <div
                      key={line.clientKey}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                    >
                      <div className="min-w-0">
                        <p className="font-bold">
                          {line.description}
                          {!line.isCustom && (
                            <Badge tone="neutral" className="ms-2">
                              من باقة
                            </Badge>
                          )}
                        </p>
                        <p className="text-sm text-slate-500">
                          {line.quantity} {line.unit} · {PRICING_METHOD_LABELS[line.pricingMethod]}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-black">
                          {total != null ? formatOMR(total) : "يُحدد بعد معرفة عدد الضيوف"}
                        </p>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`حذف خدمة ${line.description}`}
                          onClick={() => removeLine(line.clientKey)}
                        >
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* -------------------------------------------------- Step 3 */}
          <Card className="p-5">
            <h2 className="mb-1 text-xl font-black">
              <span className="text-brand-700">٣.</span> مراجعة وإرسال
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              راجع البيانات ثم أصدر عرض السعر. بعد الإصدار يصبح العرض نهائياً ولا يمكن تعديله.
            </p>
            <dl className="mb-4 grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-slate-500">العميل المتوقع</dt>
                <dd className="font-bold">{form.prospectName || "—"}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">عدد الضيوف</dt>
                <dd className="font-bold">{guestCountNum ?? "غير محدد"}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">الموقع</dt>
                <dd className="font-bold">{form.venueName || "—"}</dd>
              </div>
              <div>
                <dt className="text-sm text-slate-500">عدد الخدمات</dt>
                <dd className="font-bold">{lines.length}</dd>
              </div>
            </dl>
            {pricingBlocked && (
              <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">
                حدد عدد الضيوف أولاً حتى تُحسب الخدمات «لكل ضيف».
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">الإجمالي</p>
                <p className="text-3xl font-black text-brand-800">{formatOMR(grandTotalMilli)}</p>
              </div>
              <div className="flex gap-2">
                {savedDraftId && draftId && (
                  <Button variant="danger" onClick={() => void onDiscard()} disabled={busy !== ""}>
                    حذف المسودة
                  </Button>
                )}
                <Button
                  size="lg"
                  onClick={() => void onIssue()}
                  disabled={busy !== "" || lines.length === 0}
                >
                  {busy === "الإصدار" ? "جارٍ الإصدار…" : "إصدار عرض السعر"}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* -------------------------------------------------- Sidebar */}
        <div className="space-y-5">
          <Card className="p-5 lg:sticky lg:top-20">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-black">
              <Calculator className="h-5 w-5 text-brand-700" />
              حاسبة سريعة
            </h2>
            <p className="mb-3 text-sm text-slate-500">
              احسب سعراً قبل اتخاذ القرار — الحساب هنا لا ينشئ أي سجلات.
            </p>
            <ScratchCalculator guestCount={guestCountNum} />
          </Card>
          {lines.length > 0 && (
            <Card className="p-5">
              <p className="text-sm text-slate-500">إجمالي خدمات العرض</p>
              <p className="mt-1 text-2xl font-black">{formatOMR(grandTotalMilli)}</p>
              <Badge tone={pricingBlocked ? "warning" : "success"} className="mt-2">
                {pricingBlocked ? "ينقص عدد الضيوف" : "جاهز للإصدار"}
              </Badge>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ScratchCalculator({ guestCount }: { guestCount: number | null }) {
  const [method, setMethod] = useState<PricingMethod>("PER_UNIT");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");

  let result: MilliOMR | null = null;
  try {
    result = computeQuickLineTotalMilli(
      method,
      parseOMR(price === "" ? "0" : price),
      parseQuantityMilli(qty === "" ? "1" : qty),
      guestCount,
    );
  } catch {
    result = null;
  }

  return (
    <div className="space-y-3">
      <Field label="طريقة الحساب" htmlFor="calc-method">
        <Select id="calc-method" value={method} onChange={(e) => setMethod(e.target.value as PricingMethod)}>
          <option value="PER_UNIT">لكل وحدة</option>
          <option value="PER_GUEST">لكل ضيف</option>
          <option value="FIXED">مبلغ ثابت</option>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="كمية الحساب" htmlFor="calc-qty">
          <Input id="calc-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="سعر الحساب (ر.ع.)" htmlFor="calc-price">
          <Input
            id="calc-price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="0.000"
          />
        </Field>
      </div>
      <div className="rounded-xl bg-brand-50 p-3 text-center">
        <p className="text-sm text-brand-800">النتيجة</p>
        <p className="text-2xl font-black text-brand-900">
          {method === "PER_GUEST" && guestCount === null
            ? "حدد عدد الضيوف"
            : result !== null
              ? formatOMR(result)
              : "—"}
        </p>
      </div>
    </div>
  );
}
