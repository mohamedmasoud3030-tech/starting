import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { MoneyInput } from "@/components/MoneyInput";
import type { MilliOMR } from "@/lib/money";
import type { CompensationMethod, StaffType } from "@/lib/dbTypes";
import { COMPENSATION_LABELS, STAFF_TYPE_LABELS } from "./labels";
import {
  useSaveStaffMember,
  type StaffMemberFormValues,
  type StaffMemberRow,
} from "./staff.api";

const STAFF_TYPES = Object.keys(STAFF_TYPE_LABELS) as StaffType[];
const COMPENSATION_METHODS = Object.keys(
  COMPENSATION_LABELS,
) as CompensationMethod[];

/**
 * Roster provisioning (defect F11): create or edit a host on the staff page.
 * The write goes through the existing OWNER/MANAGER RLS policy
 * (staff_members_manage) exactly like the customers/catalog forms.
 */
export function StaffMemberDialog({
  open,
  onOpenChange,
  orgId,
  member,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  member: StaffMemberRow | null; // null → create mode
}) {
  const save = useSaveStaffMember(orgId);
  const isEditing = member !== null;

  const [name, setName] = useState(() => member?.name ?? "");
  const [staffType, setStaffType] = useState<StaffType>(
    () => member?.staffType ?? "HOST",
  );
  const [phone, setPhone] = useState(() => member?.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(() => member?.whatsapp ?? "");
  const [method, setMethod] = useState<CompensationMethod>(
    () => member?.defaultCompensationMethod ?? "PER_EVENT",
  );
  const [rateMilli, setRateMilli] = useState<MilliOMR>(
    () => member?.defaultRateMilli ?? 0,
  );
  const [isActive, setIsActive] = useState(() => member?.isActive ?? true);
  const [notes, setNotes] = useState(() => member?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("اسم المضيف مطلوب");
      return;
    }
    if (rateMilli < 0) {
      setError("الأجر الافتراضي لا يمكن أن يكون سالباً");
      return;
    }
    const values: StaffMemberFormValues = {
      name,
      staffType,
      phone,
      whatsapp,
      compensationMethod: method,
      rateMilli,
      isActive,
      notes,
    };
    try {
      await save.mutateAsync({ id: member?.id ?? null, values });
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "تعذر حفظ بيانات المضيف",
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "تعديل بيانات مضيف" : "مضيف جديد"}
      description="يُستخدم المضيف في إسناد الفريق وحساب الحضور والأجور."
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="الاسم" htmlFor="staff-name" required>
          <Input
            id="staff-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="النوع" htmlFor="staff-type" required>
          <Select
            id="staff-type"
            value={staffType}
            onChange={(e) => setStaffType(e.target.value as StaffType)}
          >
            {STAFF_TYPES.map((t) => (
              <option key={t} value={t}>
                {STAFF_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الهاتف" htmlFor="staff-phone">
          <Input
            id="staff-phone"
            dir="ltr"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label="واتساب" htmlFor="staff-whatsapp">
          <Input
            id="staff-whatsapp"
            dir="ltr"
            inputMode="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
          />
        </Field>
        <Field label="طريقة الأجر الافتراضية" htmlFor="staff-method" required>
          <Select
            id="staff-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as CompensationMethod)}
          >
            {COMPENSATION_METHODS.map((m) => (
              <option key={m} value={m}>
                {COMPENSATION_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <MoneyInput
          id="staff-rate"
          label="الأجر الافتراضي"
          value={rateMilli}
          onChange={(millis) => setRateMilli(millis ?? 0)}
          hint="بالريال العماني (3 خانات عشرية)"
        />
        <Field label="الحالة" htmlFor="staff-active">
          <Select
            id="staff-active"
            value={isActive ? "ACTIVE" : "INACTIVE"}
            onChange={(e) => setIsActive(e.target.value === "ACTIVE")}
          >
            <option value="ACTIVE">نشط</option>
            <option value="INACTIVE">غير نشط</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="ملاحظات" htmlFor="staff-notes">
            <Textarea
              id="staff-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
        {error && (
          <p className="text-sm font-bold text-red-700 sm:col-span-2" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            إلغاء
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "جارٍ الحفظ…" : isEditing ? "حفظ التعديلات" : "إضافة المضيف"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
