import { useState, type FormEvent } from "react";
import { Phone, Plus } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
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
import type { CustomerRow, CustomerType } from "@/lib/database.types";
import {
  type CustomerFormValues,
  useCustomers,
  useSaveCustomer,
} from "./customers.api";

export function CustomersPage() {
  const { currentOrganization, canWriteCustomers } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const customersQuery = useCustomers(orgId);
  const saveMutation = useSaveCustomer(orgId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  if (customersQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const customers = customersQuery.data ?? [];

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
                  <h3 className="text-lg font-bold text-slate-900">{c.name}</h3>
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

  const [lastCustomer, setLastCustomer] = useState(customer);
  if (lastCustomer !== customer) {
    setLastCustomer(customer);
    setValues(initial(customer));
    setError(null);
    setNameError(null);
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
