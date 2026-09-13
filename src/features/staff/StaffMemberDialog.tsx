import { useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { MoneyInput } from "@/components/MoneyInput";
import type { MilliOMR } from "@/lib/money";
import type { CompensationMethod, StaffType } from "@/lib/dbTypes";
import {
  COMPENSATION_LABELS,
  CONTRACT_STATUS_LABELS,
  STAFF_TYPE_LABELS,
} from "./labels";
import { EvidenceFileField } from "@/features/attachments/EvidenceFileField";
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
  const [idNumber, setIdNumber] = useState(() => member?.idNumber ?? "");
  const [method, setMethod] = useState<CompensationMethod>(
    () => member?.defaultCompensationMethod ?? "PER_EVENT",
  );
  const [rateMilli, setRateMilli] = useState<MilliOMR>(
    () => member?.defaultRateMilli ?? 0,
  );
  const [isActive, setIsActive] = useState(() => member?.isActive ?? true);
  const [notes, setNotes] = useState(() => member?.notes ?? "");
  const [hireDate, setHireDate] = useState(() => member?.hireDate ?? "");
  const [birthDate, setBirthDate] = useState(() => member?.birthDate ?? "");
  const [nationality, setNationality] = useState(() => member?.nationality ?? "");
  const [jobTitle, setJobTitle] = useState(() => member?.jobTitle ?? "");
  const [department, setDepartment] = useState(() => member?.department ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(
    () => member?.emergencyPhone ?? "",
  );
  const [iban, setIban] = useState(() => member?.iban ?? "");
  const [contractStatus, setContractStatus] = useState<string>(
    () => member?.contractStatus ?? "ACTIVE",
  );
  const [civilIdExpiry, setCivilIdExpiry] = useState(
    () => member?.civilIdExpiresOn ?? "",
  );
  const [healthCardExpiry, setHealthCardExpiry] = useState(
    () => member?.healthCardExpiresOn ?? "",
  );
  const [hrOpen, setHrOpen] = useState<boolean>(() => (member ? true : false));
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("اسم العضو مطلوب");
      return;
    }
    if (rateMilli < 0) {
      setError("الأجر الافتراضي لا يمكن أن يكون سالباً");
      return;
    }
    if (birthDate && hireDate && birthDate > hireDate) {
      setError("تاريخ الميلاد لا يمكن أن يأتي بعد تاريخ الالتحاق");
      return;
    }
    const values: StaffMemberFormValues = {
      name,
      staffType,
      phone,
      whatsapp,
      idNumber,
      compensationMethod: method,
      rateMilli,
      isActive,
      notes,
      hireDate: hireDate || null,
      birthDate: birthDate || null,
      nationality: nationality.trim() || null,
      jobTitle: jobTitle.trim() || null,
      department: department.trim() || null,
      emergencyPhone: emergencyPhone.trim() || null,
      iban: iban.trim() || null,
      contractStatus: contractStatus || "ACTIVE",
      civilIdExpiresOn: civilIdExpiry || null,
      healthCardExpiresOn: healthCardExpiry || null,
    };
    try {
      await save.mutateAsync({ id: member?.id ?? null, values });
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "تعذر حفظ بيانات العضو",
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "تعديل بيانات مضيف" : "إضافة مضيف"}
      description="بيانات المضيف وطريقة حساب أجره في المناسبات."
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
        <Field label="الدور / النوع" htmlFor="staff-type" required>
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
        <Field label="رقم الهوية / البطاقة المدنية" htmlFor="staff-id-number">
          <Input
            id="staff-id-number"
            dir="ltr"
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
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

        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={() => setHrOpen((v) => !v)}
            aria-expanded={hrOpen}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-right text-base font-black text-slate-800"
          >
            البيانات الوظيفية والتعاقدية
            <ChevronDown
              className={`h-5 w-5 text-slate-500 transition-transform ${hrOpen ? "rotate-180" : ""}`}
            />
          </button>
        </div>
        {hrOpen && (
          <>
            <Field label="تاريخ الالتحاق" htmlFor="staff-hire">
              <Input
                id="staff-hire"
                type="date"
                dir="ltr"
                value={hireDate}
                onChange={(e) => setHireDate(e.target.value)}
              />
            </Field>
            <Field label="المسمى الوظيفي" htmlFor="staff-job">
              <Input
                id="staff-job"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="مثال: رئيس مضيفين"
              />
            </Field>
            <Field label="القسم" htmlFor="staff-department">
              <Input
                id="staff-department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="مثال: الضيافة / التشغيل"
              />
            </Field>
            <Field label="حالة العقد" htmlFor="staff-contract">
              <Select
                id="staff-contract"
                value={contractStatus}
                onChange={(e) => setContractStatus(e.target.value)}
              >
                <option value="ACTIVE">{CONTRACT_STATUS_LABELS.ACTIVE}</option>
                <option value="PROBATION">{CONTRACT_STATUS_LABELS.PROBATION}</option>
                <option value="ENDED">{CONTRACT_STATUS_LABELS.ENDED}</option>
              </Select>
            </Field>
            <Field label="تاريخ الميلاد" htmlFor="staff-birth">
              <Input
                id="staff-birth"
                type="date"
                dir="ltr"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </Field>
            <Field label="الجنسية" htmlFor="staff-nationality">
              <Input
                id="staff-nationality"
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                placeholder="مثال: عماني"
              />
            </Field>
            <Field label="هاتف الطوارئ" htmlFor="staff-emergency">
              <Input
                id="staff-emergency"
                dir="ltr"
                inputMode="tel"
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
              />
            </Field>
            <Field
              label="الآيبان (لتحويل الراتب)"
              htmlFor="staff-iban"
              hint="تُحفظ البيانات البنكية داخل ملف العضو ويراها من يملك قراءة الأجور فقط."
            >
              <Input
                id="staff-iban"
                dir="ltr"
                value={iban}
                onChange={(e) => setIban(e.target.value)}
              />
            </Field>
            <Field label="انتهاء البطاقة المدنية" htmlFor="staff-civil">
              <Input
                id="staff-civil"
                type="date"
                dir="ltr"
                value={civilIdExpiry}
                onChange={(e) => setCivilIdExpiry(e.target.value)}
              />
            </Field>
            <Field label="انتهاء بطاقة التأمين الصحي" htmlFor="staff-health">
              <Input
                id="staff-health"
                type="date"
                dir="ltr"
                value={healthCardExpiry}
                onChange={(e) => setHealthCardExpiry(e.target.value)}
              />
            </Field>
          </>
        )}

        {isEditing && member && orgId && (
          <div className="grid gap-4 rounded-xl border border-slate-200 p-3 sm:col-span-2 sm:grid-cols-2">
            <p className="font-black sm:col-span-2">المستندات الخاصة</p>
            <EvidenceFileField
              orgId={orgId}
              evidenceType="STAFF_ID"
              entityType="staff_member"
              entityId={member.id}
              label="صورة الهوية / البطاقة المدنية"
              hint="محفوظة بشكل خاص — يراها المالك والمدير فقط"
              supersede
              canEdit
            />
            <EvidenceFileField
              orgId={orgId}
              evidenceType="STAFF_CONTRACT"
              entityType="staff_member"
              entityId={member.id}
              label="عقد العمل"
              hint="PDF أو صورة — يراها المالك والمدير فقط"
              supersede
              canEdit
            />
          </div>
        )}
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
            {save.isPending ? "جارٍ الحفظ…" : isEditing ? "حفظ التعديلات" : "إضافة العضو"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
