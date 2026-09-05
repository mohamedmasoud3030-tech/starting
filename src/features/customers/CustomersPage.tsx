import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Phone, Plus } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Dialog";
import { AsyncState } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { TruncationNotice } from "@/components/ui/TruncationNotice";
import { useToast } from "@/components/ui/toastContext";
import { CUSTOMER_TYPE_LABELS } from "@/lib/domain";
import { listIsTruncated } from "@/lib/listCap";
import type { CustomerRow, CustomerType } from "@/lib/dbTypes";
import {
  type CustomerFormValues,
  useCustomersPage,
  useSaveCustomer,
} from "./customers.api";

export function CustomersPage() {
  const { currentOrganization, canWriteCustomers } = useAuth();
  const toast = useToast();
  const orgId = currentOrganization?.id ?? null;
  const customersQuery = useCustomersPage(orgId);
  const saveMutation = useSaveCustomer(orgId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  const customers = customersQuery.data?.rows ?? [];
  const customersTruncated =
    customersQuery.isSuccess &&
    listIsTruncated(customersQuery.data?.rows.length ?? 0, customersQuery.data?.total);

  return (
    <div>
      <PageHeader
        title="العملاء"
        description="جهات الاتصال والعملاء"
        actions={
          canWriteCustomers ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-5 w-5" />
              عميل جديد
            </Button>
          ) : undefined
        }
      />

      <AsyncState
        loading={customersQuery.isLoading}
        error={customersQuery.error}
        onRetry={() => void customersQuery.refetch()}
      >
      {customersTruncated && (
        <div className="mb-4 space-y-3">
          <TruncationNotice
            message={`يتم عرض ${customersQuery.data?.rows.length ?? 0} من ${customersQuery.data?.total ?? "…"} عميلاً.`}
          />
          {customersQuery.hasMore && (
            <Button
              variant="secondary"
              onClick={() => customersQuery.loadMore()}
              disabled={customersQuery.isFetching}
            >
              {customersQuery.isFetching ? "جارٍ التحميل…" : "عرض المزيد من العملاء"}
            </Button>
          )}
        </div>
      )}

      {customers.length === 0 ? (
        <EmptyState
          title="لا يوجد عملاء بعد"
          description="أضف العملاء للبدء بتنظيم المناسبات لهم"
          action={
            canWriteCustomers ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-5 w-5" />
                عميل جديد
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {customers.map((c) => (
            <li key={c.id}>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Link
                    to="/customers/$customerId"
                    params={{ customerId: c.id }}
                    className="text-lg font-bold text-slate-900 hover:text-brand-700"
                  >
                    {c.name}
                  </Link>
                  <Badge tone="brand">{CUSTOMER_TYPE_LABELS[c.customer_type]}</Badge>
                </div>
                {(c.phone || c.whatsapp) && (
                  <div className="space-y-1 text-base text-slate-600">
                    {c.phone && (
                      <p className="flex items-center gap-1.5">
                        <Phone className="h-4 w-4 text-slate-400" />
                        {c.phone}
                      </p>
                    )}
                    {c.whatsapp && (
                      <p className="flex items-center gap-1.5">
                        <span className="text-sm">واتساب:</span>
                        {c.whatsapp}
                      </p>
                    )}
                  </div>
                )}
                {canWriteCustomers && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => {
                      setEditing(c);
                      setDialogOpen(true);
                    }}
                  >
                    تعديل
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      </AsyncState>

      <CustomerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customer={editing}
        saving={saveMutation.isPending}
        onSave={async (values) => {
          // Duplicate-phone guard (F10): one client must not silently split
          // into two profiles with the same phone number.
          if (!editing && values.phone.trim()) {
            const existing = (customersQuery.data?.rows ?? []).find(
              (row) =>
                row.is_active &&
                (row.phone ?? "").replace(/\s/g, "") === values.phone.trim().replace(/\s/g, ""),
            );
            if (existing) {
              throw new Error(
                `يوجد عميل بنفس رقم الهاتف: ${existing.name}. عدّل العميل القائم بدلاً من إنشاء نسخة جديدة.`,
              );
            }
          }
          await saveMutation.mutateAsync({
            id: editing?.id ?? null,
            values,
          });
          setDialogOpen(false);
          toast.success(
            editing ? `تم حفظ تعديلات العميل "${values.name}".` : `تمت إضافة العميل "${values.name}" بنجاح.`,
          );
        }}
      />
    </div>
  );
}

function CustomerDialog({
  open,
  onOpenChange,
  customer,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerRow | null;
  saving: boolean;
  onSave: (values: CustomerFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<CustomerFormValues>(() =>
    initial(customer),
  );
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // Reset the whole form on each dialog open transition and whenever the
  // target customer changes while open (no clobbering while open).
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevCustomer, setPrevCustomer] = useState(customer);
  if (open !== prevOpen || customer !== prevCustomer) {
    setPrevOpen(open);
    setPrevCustomer(customer);
    if (open) {
      setValues(initial(customer));
      setError(null);
      setNameError(null);
    }
  }

  const set = <K extends keyof CustomerFormValues>(
    key: K,
    value: CustomerFormValues[K],
  ) => setValues((v) => ({ ...v, [key]: value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNameError(null);
    if (!values.name.trim()) {
      setNameError("الاسم مطلوب");
      return;
    }
    try {
      await onSave(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء الحفظ");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={customer ? "تعديل عميل" : "عميل جديد"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="الاسم" htmlFor="cust-name" required error={nameError}>
          <Input
            id="cust-name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="رقم الهاتف" htmlFor="cust-phone">
            <Input
              id="cust-phone"
              dir="ltr"
              inputMode="tel"
              value={values.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+968 ..."
            />
          </Field>
          <Field label="رقم الواتساب" htmlFor="cust-whatsapp">
            <Input
              id="cust-whatsapp"
              dir="ltr"
              inputMode="tel"
              value={values.whatsapp}
              onChange={(e) => set("whatsapp", e.target.value)}
              placeholder="+968 ..."
            />
          </Field>
        </div>
        <Field label="نوع العميل" htmlFor="cust-type">
          <Select
            id="cust-type"
            value={values.customerType}
            onChange={(e) => set("customerType", e.target.value as CustomerType)}
          >
            {(Object.keys(CUSTOMER_TYPE_LABELS) as CustomerType[]).map((t) => (
              <option key={t} value={t}>
                {CUSTOMER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ملاحظات" htmlFor="cust-notes">
          <Textarea
            id="cust-notes"
            rows={2}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-3 text-base font-semibold text-red-700"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function initial(customer: CustomerRow | null): CustomerFormValues {
  if (!customer) {
    return { name: "", phone: "", whatsapp: "", customerType: "INDIVIDUAL", notes: "" };
  }
  return {
    name: customer.name,
    phone: customer.phone ?? "",
    whatsapp: customer.whatsapp ?? "",
    customerType: customer.customer_type,
    notes: customer.notes ?? "",
  };
}
