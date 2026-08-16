import { useMemo, useState, type FormEvent } from "react";
import { MessageCircle, Phone, Plus, Search } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Dialog";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { CUSTOMER_TYPE_LABELS } from "@/lib/domain";
import type { CustomerRow, CustomerType } from "@/lib/dbTypes";
import {
  type CustomerFormValues,
  useCustomers,
  useSaveCustomer,
} from "./customers.api";

type CustomerStatusFilter = "ACTIVE" | "INACTIVE" | "ALL";

export function CustomersPage() {
  const { currentOrganization, canWriteCustomers } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const customersQuery = useCustomers(orgId);
  const saveMutation = useSaveCustomer(orgId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CustomerStatusFilter>("ACTIVE");

  const customers = customersQuery.data ?? [];
  const visibleCustomers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ar");
    return customers.filter((customer) => {
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" && customer.is_active) ||
        (statusFilter === "INACTIVE" && !customer.is_active);
      const haystack = `${customer.name} ${customer.phone ?? ""} ${customer.whatsapp ?? ""}`.toLocaleLowerCase("ar");
      return matchesStatus && (!term || haystack.includes(term));
    });
  }, [customers, search, statusFilter]);

  if (customersQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="العملاء"
        description="سجل العملاء وبيانات التواصل المستخدمة في عروض الأسعار والمناسبات."
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

      {customers.length > 0 ? (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">البحث في العملاء</span>
            <Search className="pointer-events-none absolute right-3 top-3.5 h-5 w-5 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pr-10"
              placeholder="ابحث بالاسم أو رقم الهاتف"
            />
          </label>
          <div className="flex gap-1 overflow-x-auto" role="group" aria-label="تصفية حالة العملاء">
            {([
              ["ACTIVE", "النشطون"],
              ["INACTIVE", "غير النشطين"],
              ["ALL", "الكل"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                aria-pressed={statusFilter === value}
                className={`min-h-11 shrink-0 rounded-lg px-4 text-sm font-bold ${
                  statusFilter === value
                    ? "bg-slate-950 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {customers.length === 0 ? (
        <EmptyState
          title="لا يوجد عملاء بعد"
          description="أضف أول عميل لبدء عروض الأسعار وتنظيم المناسبات."
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
      ) : visibleCustomers.length === 0 ? (
        <EmptyState
          title="لا توجد نتائج مطابقة"
          description="غيّر عبارة البحث أو حالة العملاء."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleCustomers.map((customer) => (
            <li key={customer.id}>
              <article className="h-full rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-black text-slate-950">
                      {customer.name}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge tone="brand">{CUSTOMER_TYPE_LABELS[customer.customer_type]}</Badge>
                      {!customer.is_active ? <Badge tone="neutral">غير نشط</Badge> : null}
                    </div>
                  </div>
                </div>

                <div className="min-h-12 space-y-1.5 text-sm text-slate-600">
                  {customer.phone ? (
                    <p className="flex items-center gap-2" dir="ltr">
                      <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                      <span>{customer.phone}</span>
                    </p>
                  ) : null}
                  {customer.whatsapp ? (
                    <p className="flex items-center gap-2" dir="ltr">
                      <MessageCircle className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span>{customer.whatsapp}</span>
                    </p>
                  ) : null}
                  {!customer.phone && !customer.whatsapp ? (
                    <p className="text-slate-400">لا توجد بيانات تواصل مسجلة.</p>
                  ) : null}
                </div>

                {canWriteCustomers ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 w-full"
                    onClick={() => {
                      setEditing(customer);
                      setDialogOpen(true);
                    }}
                  >
                    تعديل بيانات العميل
                  </Button>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      )}

      <CustomerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        customer={editing}
        saving={saveMutation.isPending}
        onSave={async (values) => {
          await saveMutation.mutateAsync({
            id: editing?.id ?? null,
            values,
          });
          setDialogOpen(false);
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
    nextValue: CustomerFormValues[K],
  ) => setValues((current) => ({ ...current, [key]: nextValue }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
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
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="رقم الهاتف" htmlFor="cust-phone">
            <Input
              id="cust-phone"
              dir="ltr"
              inputMode="tel"
              value={values.phone}
              onChange={(event) => set("phone", event.target.value)}
              placeholder="+968 ..."
            />
          </Field>
          <Field label="رقم الواتساب" htmlFor="cust-whatsapp">
            <Input
              id="cust-whatsapp"
              dir="ltr"
              inputMode="tel"
              value={values.whatsapp}
              onChange={(event) => set("whatsapp", event.target.value)}
              placeholder="+968 ..."
            />
          </Field>
        </div>
        <Field label="نوع العميل" htmlFor="cust-type">
          <Select
            id="cust-type"
            value={values.customerType}
            onChange={(event) => set("customerType", event.target.value as CustomerType)}
          >
            {(Object.keys(CUSTOMER_TYPE_LABELS) as CustomerType[]).map((type) => (
              <option key={type} value={type}>
                {CUSTOMER_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ملاحظات" htmlFor="cust-notes">
          <Textarea
            id="cust-notes"
            rows={2}
            value={values.notes}
            onChange={(event) => set("notes", event.target.value)}
          />
        </Field>

        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-3 text-base font-semibold text-red-700"
          >
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
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
