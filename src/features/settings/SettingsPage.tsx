import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type { OrganizationSettingsRow } from "@/lib/dbTypes";
import {
  useOrganizationSettings,
  useSaveOrganizationSettings,
} from "./settings.api";
import { TeamPanel } from "./TeamPanel";

type FormState = Record<
  Exclude<
    keyof OrganizationSettingsRow,
    | "organization_id"
    | "created_at"
    | "updated_at"
    // Cutover stamps are financial-core commands, not branding settings.
    | "accounting_cutover_at"
    | "accounting_cutover_by"
    | "accounting_cutover_vat_payable"
  >,
  string
>;

const EMPTY_FORM: FormState = {
  name_en: "",
  logo_url: "",
  primary_color: "",
  accent_color: "",
  phone_primary: "",
  phone_secondary: "",
  whatsapp: "",
  email: "",
  commercial_registration: "",
  postal_code: "",
  po_box: "",
  address_line1: "",
  city: "",
  region: "",
  country: "",
  document_terms: "",
  document_footer: "",
  quotation_number_prefix: "QT",
  invoice_number_prefix: "INV",
  event_number_prefix: "EV",
  manager_name: "",
  manager_title: "",
  vat_registered: "false",
  vat_percent: "5.000",
  vat_registration_number: "",
};

function toForm(row: OrganizationSettingsRow | null): FormState {
  if (!row) return { ...EMPTY_FORM };
  return {
    ...EMPTY_FORM,
    ...Object.fromEntries(
      Object.entries(row)
        .filter(
          ([k]) =>
            k !== "organization_id" &&
            k !== "created_at" &&
            k !== "updated_at" &&
            k !== "accounting_cutover_at" &&
            k !== "accounting_cutover_by" &&
            k !== "accounting_cutover_vat_payable",
        )
        .map(([k, v]) => [
          k,
          k === "vat_registered" ? String(!!v) : v == null ? "" : String(v),
        ]),
    ),
  } as FormState;
}

export function SettingsPage() {
  const { currentOrganization, hasCapability } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  // Editing is gated by the settings.manage capability (0079); OWNER holds
  // it by preset. The server command enforces the same boundary.
  const canEditSettings = hasCapability("settings.manage");

  const settings = useOrganizationSettings(orgId);
  const save = useSaveOrganizationSettings(orgId);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync server data into the form exactly once it arrives.
  if (settings.isSuccess && !hydrated) {
    setForm(toForm(settings.data));
    setHydrated(true);
  }

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!orgId) return;
    setError(null);
    setSavedAt(null);
    try {
      await save.mutateAsync({
        p_org_id: orgId,
        p_name_en: form.name_en,
        p_logo_url: form.logo_url,
        p_primary_color: form.primary_color,
        p_accent_color: form.accent_color,
        p_phone_primary: form.phone_primary,
        p_phone_secondary: form.phone_secondary,
        p_whatsapp: form.whatsapp,
        p_email: form.email,
        p_commercial_registration: form.commercial_registration,
        p_postal_code: form.postal_code,
        p_po_box: form.po_box,
        p_address_line1: form.address_line1,
        p_city: form.city,
        p_region: form.region,
        p_country: form.country,
        p_document_terms: form.document_terms,
        p_document_footer: form.document_footer,
        p_quotation_number_prefix: form.quotation_number_prefix,
        p_invoice_number_prefix: form.invoice_number_prefix,
        p_event_number_prefix: form.event_number_prefix,
        p_manager_name: form.manager_name,
        p_manager_title: form.manager_title,
        p_vat_registered: form.vat_registered === "true",
        p_vat_percent: Number(form.vat_percent || "0"),
        p_vat_registration_number: form.vat_registration_number,
      });
      setSavedAt(new Date().toLocaleTimeString("ar-OM", { timeZone: "Asia/Muscat" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ الإعدادات.");
    }
  }

  return (
    <div>
      <PageHeader
        title="إعدادات المنشأة"
        description="هوية المنشأة وبيانات التواصل والمستندات — تظهر على عروض الأسعار والفواتير"
        actions={
          canEditSettings ? (
            <Button type="submit" form="settings-form" disabled={save.isPending}>
              <Save className="h-5 w-5" />
              {save.isPending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
            </Button>
          ) : undefined
        }
      />

      {!canEditSettings && (
        <Card className="mb-5 border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
          هذه الإعدادات للاطلاع فقط — تعديلها متاح لمن يملك صلاحية إعدادات المنشأة.
        </Card>
      )}

      {savedAt && (
        <Card className="mb-5 border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
          حُفظت الإعدادات بنجاح (الساعة {savedAt}).
        </Card>
      )}
      {error && (
        <Card className="mb-5 border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {error}
        </Card>
      )}

      <div className="mb-5">
        <TeamPanel />
      </div>

      {settings.isLoading ? (
        <p className="py-12 text-center text-slate-500">جارٍ تحميل الإعدادات…</p>
      ) : (
        <form id="settings-form" onSubmit={onSubmit} className="space-y-5">
          <Card className="p-5">
            <h2 className="font-black">الهوية</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="اسم المنشأة (عربي)" htmlFor="set-name-ar">
                <Input id="set-name-ar" value={currentOrganization?.name ?? ""} disabled />
              </Field>
              <Field label="الاسم الإنجليزي" htmlFor="set-name-en">
                <Input
                  id="set-name-en"
                  dir="ltr"
                  value={form.name_en}
                  onChange={(e) => set("name_en", e.target.value)}
                  placeholder="Company name in English"
                  disabled={!canEditSettings}
                />
              </Field>
              <Field label="رابط الشعار (URL)" htmlFor="set-logo">
                <Input
                  id="set-logo"
                  dir="ltr"
                  value={form.logo_url}
                  onChange={(e) => set("logo_url", e.target.value)}
                  placeholder="https://…/logo.png"
                  disabled={!canEditSettings}
                />
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-black">بيانات التواصل</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="الجوال الأساسي" htmlFor="set-phone1">
                <Input id="set-phone1" dir="ltr" value={form.phone_primary} onChange={(e) => set("phone_primary", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="الجوال الثانوي" htmlFor="set-phone2">
                <Input id="set-phone2" dir="ltr" value={form.phone_secondary} onChange={(e) => set("phone_secondary", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="واتساب" htmlFor="set-whatsapp">
                <Input id="set-whatsapp" dir="ltr" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="البريد الإلكتروني" htmlFor="set-email">
                <Input id="set-email" dir="ltr" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} disabled={!canEditSettings} />
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-black">بيانات رسمية وعنوان</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="السجل التجاري (س.ت)" htmlFor="set-cr">
                <Input id="set-cr" dir="ltr" value={form.commercial_registration} onChange={(e) => set("commercial_registration", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="الرمز البريدي" htmlFor="set-postal">
                <Input id="set-postal" dir="ltr" value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="صندوق البريد (اختياري)" htmlFor="set-pobox">
                <Input id="set-pobox" dir="ltr" value={form.po_box} onChange={(e) => set("po_box", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="العنوان" htmlFor="set-address">
                <Input id="set-address" value={form.address_line1} onChange={(e) => set("address_line1", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="المدينة" htmlFor="set-city">
                <Input id="set-city" value={form.city} onChange={(e) => set("city", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="المنطقة" htmlFor="set-region">
                <Input id="set-region" value={form.region} onChange={(e) => set("region", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="الدولة" htmlFor="set-country">
                <Input id="set-country" value={form.country} onChange={(e) => set("country", e.target.value)} disabled={!canEditSettings} />
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-black">ترقيم المستندات</h2>
            <p className="mt-1 text-sm text-slate-500">
              بادئات أرقام المستندات (تُغيّر الأرقام الجديدة فقط، ولا تمسّ الأرقام السابقة).
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field label="بادئة عروض الأسعار" htmlFor="set-pq">
                <Input id="set-pq" dir="ltr" value={form.quotation_number_prefix} onChange={(e) => set("quotation_number_prefix", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="بادئة الفواتير" htmlFor="set-pi">
                <Input id="set-pi" dir="ltr" value={form.invoice_number_prefix} onChange={(e) => set("invoice_number_prefix", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="بادئة المناسبات" htmlFor="set-pe">
                <Input id="set-pe" dir="ltr" value={form.event_number_prefix} onChange={(e) => set("event_number_prefix", e.target.value)} disabled={!canEditSettings} />
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-black">ضريبة القيمة المضافة (VAT)</h2>
            <p className="mt-1 text-sm text-slate-500">
              عند التفعيل تُثبَّت النسبة على عروض الأسعار والفواتير وقت الإصدار، ولا تتغير المستندات الصادرة لاحقاً.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field label="مسجّل في الضريبة" htmlFor="set-vat-registered">
                <Select
                  id="set-vat-registered"
                  value={form.vat_registered === "true" ? "true" : "false"}
                  onChange={(e) => set("vat_registered", e.target.value)}
                  disabled={!canEditSettings}
                >
                  <option value="false">غير مسجّل</option>
                  <option value="true">مسجّل</option>
                </Select>
              </Field>
              <Field label="نسبة الضريبة %" htmlFor="set-vat-percent">
                <Input
                  id="set-vat-percent"
                  dir="ltr"
                  inputMode="decimal"
                  value={form.vat_percent}
                  onChange={(e) => set("vat_percent", e.target.value)}
                  disabled={!canEditSettings}
                />
              </Field>
              <Field label="الرقم الضريبي" htmlFor="set-vat-number">
                <Input
                  id="set-vat-number"
                  dir="ltr"
                  value={form.vat_registration_number}
                  onChange={(e) => set("vat_registration_number", e.target.value)}
                  disabled={!canEditSettings}
                />
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-black">المستندات والتوقيع</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="الشروط العامة (تظهر أسفل المستند)" htmlFor="set-terms">
                <Textarea id="set-terms" rows={4} value={form.document_terms} onChange={(e) => set("document_terms", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="تذييل المستند" htmlFor="set-footer">
                <Textarea id="set-footer" rows={4} value={form.document_footer} onChange={(e) => set("document_footer", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="اسم المدير (للتوقيع)" htmlFor="set-manager">
                <Input id="set-manager" value={form.manager_name} onChange={(e) => set("manager_name", e.target.value)} disabled={!canEditSettings} />
              </Field>
              <Field label="صفة الموقّع" htmlFor="set-manager-title">
                <Input id="set-manager-title" value={form.manager_title} onChange={(e) => set("manager_title", e.target.value)} disabled={!canEditSettings} />
              </Field>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}
