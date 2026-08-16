import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Calculator, Package, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
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
  arabicQuotationError,
  usePersistQuotationDraft,
  useCancelQuotationDraft,
  useIssueQuotation,
  useQuotation,
  useQuotationLines,
  type QuotationDraftValues,
} from "./quotes.api";
import { computeQuotationLineTotalMilli, sumQuotationLineTotals } from "./quotationMath";

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
  expectedUnitCost: string;
  sourceCatalogItemId: string | null;
  sourcePackageId: string | null;
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

function toDraftValues(form: DraftForm, guestCount: number | null): QuotationDraftValues {
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

export function QuotationEditor({ draftId }: { draftId?: string }) {
  const { currentOrganization, canManageCommercial } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const navigate = useNavigate();

  const existing = useQuotation(orgId, draftId ?? "");
  const existingLines = useQuotationLines(orgId, draftId ?? "");
  const packages = usePackages(orgId);
  const catalog = useCatalogItems(orgId, true);

  const persistDraftMutation = usePersistQuotationDraft(orgId);
  const issue = useIssueQuotation(orgId);
  const discard = useCancelQuotationDraft(orgId);

  const [form, setForm] = useState<DraftForm>(emptyForm);
  const [guestCount, setGuestCount] = useState("");
  const [savedDraftId, setSavedDraftId] = useState<string | null>(draftId ?? null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [issueConfirmationOpen, setIssueConfirmationOpen] = useState(false);
  const saveIntentRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  // Edit mode: hydrate from the persisted draft.
  useEffect(() => {
    if (draftId && existing.data) {
      setForm({
        prospectName: existing.data.customer_name_snapshot,
        prospectPhone: existing.data.customer_phone_snapshot ?? "",
        prospectWhatsapp: existing.data.prospect_whatsapp ?? "",
        prospectCompany: existing.data.prospect_company ?? "",
        eventTitle: existing.data.event_title_snapshot ?? "",
        eventType: existing.data.event_type_snapshot ?? "",
        startAt: isoToLocalInput(existing.data.start_at_snapshot),
        endAt: isoToLocalInput(existing.data.end_at_snapshot),
        venueName: existing.data.venue_snapshot ?? "",
        notes: existing.data.notes ?? "",
      });
      setGuestCount(existing.data.guest_count_snapshot != null ? String(existing.data.guest_count_snapshot) : "");
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
          expectedUnitCost: l.expected_unit_cost ?? "0.000",
          sourceCatalogItemId: l.source_catalog_item_id,
          sourcePackageId: l.source_package_id,
        })),
      );
    }
  }, [draftId, existingLines.data]);

  const guestCountNum = guestCount.trim() === "" ? null : Number(guestCount);

  // Hooks must run unconditionally, before any early return.
  const lineTotals = useMemo<Array<MilliOMR | null>>(
    () =>
      lines.map((line) => {
        try {
          return computeQuotationLineTotalMilli(
            line.pricingMethod,
            parseOMR(line.unitSellingPrice),
            parseQuantityMilli(line.quantity),
            guestCountNum,
          );
        } catch {
          return null;
        }
      }),
    [lines, guestCountNum],
  );
  const grandTotalMilli = useMemo(() => sumQuotationLineTotals(lineTotals), [lineTotals]);
  const pricingBlocked = useMemo(
    () => lineTotals.some((total) => total === null),
    [lineTotals],
  );

  if (!canManageCommercial) {
    return (
      <p className="rounded-xl bg-amber-50 p-4 font-bold text-amber-800">
        عروض الأسعار متاحة للمالك والمدير فقط.
      </p>
    );
  }

  async function persistDraft(): Promise<string> {
    const values = toDraftValues(form, guestCountNum);
    const draftLines = lines.map((line) => ({
      id: line.id,
      description: line.description,
      itemType: line.itemType,
      unit: line.unit,
      pricingMethod: line.pricingMethod,
      quantity: line.quantity,
      unitSellingPrice: line.unitSellingPrice,
      expectedUnitCost: line.expectedUnitCost,
      isCustom: line.isCustom,
      sourceCatalogItemId: line.sourceCatalogItemId,
      sourcePackageId: line.sourcePackageId,
    }));
    const fingerprint = JSON.stringify({ quotationId: savedDraftId, values, lines: draftLines });
    if (!saveIntentRef.current || saveIntentRef.current.fingerprint !== fingerprint) {
      saveIntentRef.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
    }

    // Keep the key after an error: a lost response retries the exact command.
    // Rotate only after a confirmed response or when the payload changes.
    const quote = await persistDraftMutation.mutateAsync({
      quotationId: savedDraftId,
      idempotencyKey: saveIntentRef.current.idempotencyKey,
      values,
      lines: draftLines,
    });
    setSavedDraftId(quote.id);
    saveIntentRef.current = null;
    return quote.id;
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
        expectedUnitCost: "0.000",
        sourceCatalogItemId: null,
        sourcePackageId: null,
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
        expectedUnitCost: item.cost_price == null ? "0.000" : toOMRString(fromDbAmount(item.cost_price)),
        sourceCatalogItemId: item.id,
        sourcePackageId: selectedPackage,
      };
    });
    setLines((ls) => [...ls, ...added]);
    setSelectedPackage("");
  }

  function updateLine(
    clientKey: string,
    patch: Partial<Pick<DraftLine, "description" | "quantity" | "unitSellingPrice">>,
  ) {
    setLines((current) =>
      current.map((line) => line.clientKey === clientKey ? { ...line, ...patch } : line),
    );
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
      setError(arabicQuotationError(x));
      setBusy("");
    }
  }

  async function onSaveDraft() {
    setError("");
    setBusy("الحفظ");
    try {
      const id = await persistDraft();
      if (!draftId) await navigate({ to: "/quotes/$quoteId", params: { quoteId: id } });
      setBusy("");
    } catch (cause) {
      setError(arabicQuotationError(cause));
      setBusy("");
    }
  }

  async function onIssue() {
    setIssueConfirmationOpen(false);
    setError("");
    if (lines.length === 0) {
      setError("أضف خدمة واحدة على الأقل قبل الإصدار");
      return;
    }
    setBusy("الإصدار");
    try {
      const id = await persistDraft();
      const quote = await issue.mutateAsync(id);
      await navigate({ to: "/quotes/$quoteId", params: { quoteId: id } });
      void quote;
    } catch (x) {
      setError(arabicQuotationError(x));
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
          <Card id="quotation-services" className="scroll-mt-24 p-5">
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
                      className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem_auto] sm:items-end"
                    >
                      <Field label="الخدمة" htmlFor={`draft-description-${line.clientKey}`}>
                        <div className="relative">
                          <Input
                            id={`draft-description-${line.clientKey}`}
                            aria-label={`وصف خدمة ${line.description}`}
                            value={line.description}
                            onChange={(event) => updateLine(line.clientKey, { description: event.target.value })}
                          />
                          {!line.isCustom && (
                            <Badge tone="neutral" className="absolute top-3 left-2">
                              من باقة
                            </Badge>
                          )}
                        </div>
                      </Field>
                      <Field label={`الكمية (${line.unit})`} htmlFor={`draft-quantity-${line.clientKey}`}>
                        <Input
                          id={`draft-quantity-${line.clientKey}`}
                          aria-label={`كمية خدمة ${line.description}`}
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(event) => updateLine(line.clientKey, { quantity: event.target.value })}
                        />
                      </Field>
                      <Field label="سعر الوحدة (ر.ع.)" htmlFor={`draft-price-${line.clientKey}`}>
                        <Input
                          id={`draft-price-${line.clientKey}`}
                          aria-label={`سعر خدمة ${line.description}`}
                          inputMode="decimal"
                          value={line.unitSellingPrice}
                          onChange={(event) => updateLine(line.clientKey, { unitSellingPrice: event.target.value })}
                        />
                      </Field>
                      <div className="flex min-h-12 items-center justify-between gap-2 sm:justify-end">
                        <div className="text-left">
                          <p className="text-xs text-slate-500">{PRICING_METHOD_LABELS[line.pricingMethod]}</p>
                          <p className="font-black">
                            {total != null ? formatOMR(total) : "حدد الضيوف"}
                          </p>
                        </div>
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
              <div className="flex flex-wrap gap-2">
                {savedDraftId && draftId && (
                  <Button variant="danger" onClick={() => void onDiscard()} disabled={busy !== ""}>
                    إلغاء المسودة
                  </Button>
                )}
                <Button variant="secondary" onClick={() => void onSaveDraft()} disabled={busy !== "" || !form.prospectName.trim() || pricingBlocked}>
                  {busy === "الحفظ" ? "جارٍ الحفظ…" : "حفظ المسودة"}
                </Button>
                <Button
                  size="lg"
                  onClick={() => setIssueConfirmationOpen(true)}
                  disabled={busy !== "" || lines.length === 0 || pricingBlocked}
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

      <Dialog
        open={issueConfirmationOpen}
        onOpenChange={setIssueConfirmationOpen}
        title="تأكيد إصدار عرض السعر"
        description="سيُنشأ رقم رسمي وتصبح الأسعار والخدمات لقطة تجارية غير قابلة للتعديل. راجع الإجمالي قبل المتابعة."
      >
        <div className="space-y-5">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm font-bold text-slate-500">الإجمالي النهائي</p>
            <p className="mt-1 text-3xl font-black text-slate-900">{formatOMR(grandTotalMilli)}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIssueConfirmationOpen(false)}>العودة للمراجعة</Button>
            <Button onClick={() => void onIssue()} disabled={busy !== ""}>تأكيد الإصدار</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ScratchCalculator({ guestCount }: { guestCount: number | null }) {
  const [method, setMethod] = useState<PricingMethod>("PER_UNIT");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");

  let result: MilliOMR | null = null;
  try {
    result = computeQuotationLineTotalMilli(
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
