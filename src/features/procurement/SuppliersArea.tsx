import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Building2, Phone, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { Textarea } from "@/components/ui/Textarea";
import type {
  ProcurementAccess,
  ProcurementDataSource,
  SupplierDetail,
  SupplierKind,
  SupplierListItem,
  SupplierStatus,
} from "./contracts";
import { capabilityMessage, procurementErrorMessage } from "./errors";
import {
  SUPPLIER_KIND_LABELS,
  SUPPLIER_STATUS_LABELS,
  formatProcurementDateTime,
} from "./presentation";
import {
  supplierDraftToInput,
  validateSupplierDraft,
  type SupplierFormDraft,
} from "./validation";

const SUPPLIER_KINDS = Object.keys(SUPPLIER_KIND_LABELS) as SupplierKind[];

interface SuppliersAreaProps {
  dataSource: ProcurementDataSource;
  access: ProcurementAccess;
}

function SupplierForm({
  target,
  busy,
  submitError,
  onSubmit,
  onCancel,
}: {
  target: SupplierDetail | null;
  busy: boolean;
  submitError: string;
  onSubmit: (draft: SupplierFormDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SupplierFormDraft>(() => ({
    name: target?.name ?? "",
    kind: target?.kind ?? "",
    phone: target?.phone ?? "",
    contactName: target?.contactName ?? "",
    notes: target?.notes ?? "",
  }));
  const [errors, setErrors] = useState(() => validateSupplierDraft({
    name: target?.name ?? "مورد",
    kind: target?.kind ?? "OTHER",
    phone: target?.phone ?? "",
    contactName: target?.contactName ?? "",
    notes: target?.notes ?? "",
  }));

  function update(patch: Partial<SupplierFormDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateSupplierDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSubmit(draft);
  }

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <Field label="اسم المورد" htmlFor="procurement-supplier-name" required error={errors.name}>
        <Input
          id="procurement-supplier-name"
          value={draft.name}
          autoComplete="organization"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "procurement-supplier-name-error" : undefined}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="مثال: شركة الضيافة العمانية"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نوع المورد" htmlFor="procurement-supplier-kind" required error={errors.kind}>
          <Select
            id="procurement-supplier-kind"
            value={draft.kind}
            aria-invalid={Boolean(errors.kind)}
            aria-describedby={errors.kind ? "procurement-supplier-kind-error" : undefined}
            onChange={(event) => update({ kind: event.target.value as SupplierKind })}
          >
            <option value="">اختر النوع</option>
            {SUPPLIER_KINDS.map((kind) => (
              <option key={kind} value={kind}>{SUPPLIER_KIND_LABELS[kind]}</option>
            ))}
          </Select>
        </Field>
        <Field label="رقم الهاتف" htmlFor="procurement-supplier-phone" error={errors.phone}>
          <Input
            id="procurement-supplier-phone"
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            value={draft.phone}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? "procurement-supplier-phone-error" : undefined}
            onChange={(event) => update({ phone: event.target.value })}
            placeholder="+968 9000 0000"
          />
        </Field>
      </div>
      <Field label="اسم مسؤول التواصل" htmlFor="procurement-supplier-contact">
        <Input
          id="procurement-supplier-contact"
          value={draft.contactName}
          autoComplete="name"
          onChange={(event) => update({ contactName: event.target.value })}
        />
      </Field>
      <Field label="ملاحظات" htmlFor="procurement-supplier-notes">
        <Textarea
          id="procurement-supplier-notes"
          rows={3}
          value={draft.notes}
          onChange={(event) => update({ notes: event.target.value })}
        />
      </Field>
      {submitError && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">
          {submitError}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={busy}>إلغاء</Button>
        <Button type="submit" disabled={busy} aria-disabled={busy}>
          {busy ? "جارٍ الحفظ…" : target ? "حفظ التعديلات" : "إضافة المورد"}
        </Button>
      </div>
    </form>
  );
}

function SupplierCreateDialog({
  open,
  dataSource,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  dataSource: ProcurementDataSource;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(draft: SupplierFormDraft) {
    setBusy(true);
    setError("");
    try {
      await dataSource.createSupplier(supplierDraftToInput(draft));
      onOpenChange(false);
      onCreated();
    } catch (cause) {
      setError(procurementErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      title="إضافة مورد"
      description="أدخل بيانات التواصل الأساسية. يمكن إكمال الملاحظات لاحقاً."
    >
      {open && (
        <SupplierForm
          key="new-supplier"
          target={null}
          busy={busy}
          submitError={error}
          onSubmit={(draft) => void submit(draft)}
          onCancel={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-bold text-slate-900">{children}</dd>
    </div>
  );
}

function SupplierDetailDialog({
  supplierId,
  dataSource,
  onClose,
  onChanged,
}: {
  supplierId: string | null;
  dataSource: ProcurementDataSource;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"details" | "edit" | "deactivate">("details");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!supplierId) return;
    let current = true;
    setLoading(true);
    setLoadError("");
    setDetail(null);
    setMode("details");
    void dataSource.getSupplier(supplierId).then(
      (value) => {
        if (current) setDetail(value);
      },
      (cause) => {
        if (current) setLoadError(procurementErrorMessage(cause));
      },
    ).finally(() => {
      if (current) setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [dataSource, supplierId, reload]);

  async function save(draft: SupplierFormDraft) {
    if (!supplierId) return;
    setBusy(true);
    setActionError("");
    try {
      const updated = await dataSource.updateSupplier(supplierId, supplierDraftToInput(draft));
      setDetail(updated);
      setMode("details");
      onChanged();
    } catch (cause) {
      setActionError(procurementErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!supplierId) return;
    setBusy(true);
    setActionError("");
    try {
      const updated = await dataSource.deactivateSupplier(supplierId);
      setDetail(updated);
      setMode("details");
      onChanged();
    } catch (cause) {
      setActionError(procurementErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "edit" ? "تعديل المورد" : mode === "deactivate" ? "تأكيد إيقاف المورد" : "تفاصيل المورد";

  return (
    <Dialog open={supplierId !== null} onOpenChange={(open) => !open && !busy && onClose()} title={title}>
      {loading && (
        <div className="flex min-h-40 items-center justify-center gap-3" aria-busy="true">
          <Spinner /><span className="font-bold text-slate-600">جارٍ تحميل المورد…</span>
        </div>
      )}
      {!loading && loadError && (
        <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          <p className="font-bold">{loadError}</p>
          <Button variant="outline" className="mt-3" onClick={() => setReload((value) => value + 1)}>إعادة المحاولة</Button>
        </div>
      )}
      {!loading && detail && mode === "edit" && (
        <SupplierForm
          key={`edit-${detail.id}`}
          target={detail}
          busy={busy}
          submitError={actionError}
          onSubmit={(draft) => void save(draft)}
          onCancel={() => { setMode("details"); setActionError(""); }}
        />
      )}
      {!loading && detail && mode === "deactivate" && (
        <div className="space-y-4">
          <p className="text-lg font-bold">هل تريد إيقاف «{detail.name}»؟</p>
          <p className="text-slate-600">لن يظهر المورد ضمن خيارات الطلبات الجديدة. الطلبات السابقة ستبقى محفوظة.</p>
          {actionError && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">{actionError}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={busy} onClick={() => setMode("details")}>العودة</Button>
            <Button variant="danger" disabled={busy} onClick={() => void deactivate()}>{busy ? "جارٍ الإيقاف…" : "نعم، أوقف المورد"}</Button>
          </div>
        </div>
      )}
      {!loading && detail && mode === "details" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-black">{detail.name}</h3>
              <p className="mt-1 text-slate-600">{SUPPLIER_KIND_LABELS[detail.kind]}</p>
            </div>
            <Badge tone={detail.status === "ACTIVE" ? "success" : "neutral"}>{SUPPLIER_STATUS_LABELS[detail.status]}</Badge>
          </div>
          <dl className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
            <DetailRow label="رقم الهاتف"><span dir="ltr">{detail.phone ?? "—"}</span></DetailRow>
            <DetailRow label="مسؤول التواصل">{detail.contactName ?? "—"}</DetailRow>
            <DetailRow label="آخر طلب">{formatProcurementDateTime(detail.lastOrderAt)}</DetailRow>
            {detail.openOrderCount != null && <DetailRow label="الطلبات المفتوحة">{detail.openOrderCount}</DetailRow>}
          </dl>
          {detail.notes && <div><h4 className="font-bold">ملاحظات</h4><p className="mt-1 whitespace-pre-wrap text-slate-600">{detail.notes}</p></div>}
          {actionError && <p role="alert" className="rounded-xl bg-red-50 p-3 font-bold text-red-700">{actionError}</p>}
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row">
            <div>
              <Button variant="secondary" disabled={!detail.capabilities.edit.allowed} onClick={() => setMode("edit")}>تعديل البيانات</Button>
              {!detail.capabilities.edit.allowed && <p className="mt-1 max-w-64 text-xs font-semibold text-slate-500">{capabilityMessage(detail.capabilities.edit.reason)}</p>}
            </div>
            {detail.status === "ACTIVE" && (
              <div>
                <Button variant="danger" disabled={!detail.capabilities.deactivate.allowed} onClick={() => setMode("deactivate")}>إيقاف المورد</Button>
                {!detail.capabilities.deactivate.allowed && <p className="mt-1 max-w-64 text-xs font-semibold text-slate-500">{capabilityMessage(detail.capabilities.deactivate.reason)}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function SupplierCard({ supplier, onOpen }: { supplier: SupplierListItem; onOpen: () => void }) {
  return (
    <Card className="overflow-hidden">
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-brand-50 text-brand-700" aria-hidden="true"><Building2 /></span>
            <div className="min-w-0"><h3 className="truncate text-lg font-black">{supplier.name}</h3><p className="text-sm font-semibold text-slate-500">{SUPPLIER_KIND_LABELS[supplier.kind]}</p></div>
          </div>
          <Badge tone={supplier.status === "ACTIVE" ? "success" : "neutral"}>{SUPPLIER_STATUS_LABELS[supplier.status]}</Badge>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-slate-500">رقم الهاتف</dt><dd className="mt-1 flex items-center gap-1 font-bold" dir="ltr"><Phone className="h-4 w-4" aria-hidden="true" />{supplier.phone ?? "—"}</dd></div>
          <div><dt className="text-slate-500">آخر طلب</dt><dd className="mt-1 font-bold">{formatProcurementDateTime(supplier.lastOrderAt)}</dd></div>
          {supplier.openOrderCount != null && <div><dt className="text-slate-500">الطلبات المفتوحة</dt><dd className="mt-1 text-lg font-black">{supplier.openOrderCount}</dd></div>}
        </dl>
        <Button variant="outline" className="w-full" onClick={onOpen} aria-label={`عرض تفاصيل المورد ${supplier.name}`}>عرض التفاصيل</Button>
      </CardBody>
    </Card>
  );
}

export function SuppliersArea({ dataSource, access }: SuppliersAreaProps) {
  const [suppliers, setSuppliers] = useState<SupplierListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SupplierStatus | "ALL">("ALL");
  const [kind, setKind] = useState<SupplierKind | "ALL">("ALL");
  const [creating, setCreating] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void dataSource.listSuppliers().then(
      (items) => { if (current) setSuppliers(items); },
      (cause) => { if (current) setError(procurementErrorMessage(cause)); },
    ).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [dataSource, reload]);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ar");
    return suppliers.filter((supplier) => {
      const matchesSearch = !needle || supplier.name.toLocaleLowerCase("ar").includes(needle) || (supplier.phone ?? "").includes(needle);
      return matchesSearch && (status === "ALL" || supplier.status === status) && (kind === "ALL" || supplier.kind === kind);
    });
  }, [kind, search, status, suppliers]);

  const filtered = Boolean(search.trim() || status !== "ALL" || kind !== "ALL");

  return (
    <section aria-labelledby="suppliers-heading" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="suppliers-heading" className="text-2xl font-black">الموردون</h2><p className="mt-1 text-slate-600">بيانات التواصل وحالة التعامل والطلبات المفتوحة.</p></div>
        {access.canCreateSupplier && <Button size="lg" onClick={() => setCreating(true)}><Plus aria-hidden="true" />إضافة مورد</Button>}
      </div>
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
        <Field label="بحث" htmlFor="supplier-search">
          <div className="relative"><Search className="pointer-events-none absolute right-3 top-3.5 h-5 w-5 text-slate-400" aria-hidden="true" /><Input id="supplier-search" className="pr-10" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم المورد أو الهاتف" /></div>
        </Field>
        <Field label="الحالة" htmlFor="supplier-status-filter"><Select id="supplier-status-filter" value={status} onChange={(event) => setStatus(event.target.value as SupplierStatus | "ALL")}><option value="ALL">كل الحالات</option><option value="ACTIVE">نشط</option><option value="INACTIVE">غير نشط</option></Select></Field>
        <Field label="النوع" htmlFor="supplier-kind-filter"><Select id="supplier-kind-filter" value={kind} onChange={(event) => setKind(event.target.value as SupplierKind | "ALL")}><option value="ALL">كل الأنواع</option>{SUPPLIER_KINDS.map((value) => <option key={value} value={value}>{SUPPLIER_KIND_LABELS[value]}</option>)}</Select></Field>
      </div>
      {loading && <div className="flex min-h-52 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white" aria-busy="true"><Spinner /><span className="font-bold text-slate-600">جارٍ تحميل الموردين…</span></div>}
      {!loading && error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"><p className="font-black">تعذر تحميل الموردين</p><p className="mt-1 font-semibold">{error}</p><Button variant="outline" className="mt-4" onClick={() => setReload((value) => value + 1)}>إعادة المحاولة</Button></div>}
      {!loading && !error && visible.length === 0 && <EmptyState title={filtered ? "لا توجد نتائج مطابقة" : "لا يوجد موردون بعد"} description={filtered ? "غيّر كلمات البحث أو عوامل التصفية." : "أضف أول مورد لبدء إنشاء طلبات التوريد."} action={filtered ? <Button variant="outline" onClick={() => { setSearch(""); setStatus("ALL"); setKind("ALL"); }}>مسح عوامل التصفية</Button> : access.canCreateSupplier ? <Button onClick={() => setCreating(true)}>إضافة أول مورد</Button> : undefined} />}
      {!loading && !error && visible.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">{visible.map((supplier) => <SupplierCard key={supplier.id} supplier={supplier} onOpen={() => setSelectedSupplierId(supplier.id)} />)}</div>}
      <SupplierCreateDialog open={creating} dataSource={dataSource} onOpenChange={setCreating} onCreated={() => setReload((value) => value + 1)} />
      <SupplierDetailDialog supplierId={selectedSupplierId} dataSource={dataSource} onClose={() => setSelectedSupplierId(null)} onChanged={() => setReload((value) => value + 1)} />
    </section>
  );
}
