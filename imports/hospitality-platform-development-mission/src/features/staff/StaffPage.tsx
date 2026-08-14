import { useMemo, useState } from "react";
import { useSession } from "@/app/session";
import { upsertStaffMember, useEngine } from "@/engine/engine";
import {
  COMPENSATION_LABELS,
  STAFF_TYPE_LABELS,
  canManageStaffDirectoryFor,
  canReadCostFor,
  type CompensationMethod,
  type StaffType,
} from "@/lib/domain";
import { errorMessage } from "@/lib/errors";
import { formatOMR } from "@/lib/money";
import { MoneyInput } from "@/components/MoneyInput";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";
import type { StaffMember } from "@/engine/types";

const EMPTY = {
  name: "",
  phone: "",
  whatsapp: "",
  staffType: "HOST" as StaffType,
  defaultCompensationMethod: "PER_EVENT" as CompensationMethod,
  defaultRateMilli: 15000,
  notes: "",
};

export function StaffPage() {
  const { session } = useSession();
  const state = useEngine();
  const canWrite = canManageStaffDirectoryFor(session!.role);
  const canCost = canReadCostFor(session!.role);
  const staff = useMemo(
    () =>
      state.staffMembers.filter((s) => s.organizationId === session!.organizationId),
    [state.staffMembers, session],
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setError("");
    setOpen(true);
  }

  function openEdit(member: StaffMember) {
    setEditing(member);
    setForm({
      name: member.name,
      phone: member.phone,
      whatsapp: member.whatsapp,
      staffType: member.staffType,
      defaultCompensationMethod: member.defaultCompensationMethod,
      defaultRateMilli: member.defaultRateMilli,
      notes: member.notes,
    });
    setError("");
    setOpen(true);
  }

  function save() {
    setSaving(true);
    setError("");
    try {
      upsertStaffMember(session, { id: editing?.id, ...form });
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="الفريق"
        subtitle="عمال التشغيل — ليسوا بالضرورة مستخدمي النظام."
        actions={
          canWrite ? <Button onClick={openCreate}>+ موظف</Button> : undefined
        }
      />
      {staff.length === 0 ? (
        <EmptyState title="لا يوجد موظفون" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {staff.map((m) => (
            <Card key={m.id}>
              <CardBody className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-extrabold">{m.name}</h2>
                    <p className="text-sm text-slate-500">
                      {STAFF_TYPE_LABELS[m.staffType]}
                    </p>
                  </div>
                  <Badge tone={m.isActive ? "success" : "neutral"}>
                    {m.isActive ? "نشط" : "غير نشط"}
                  </Badge>
                </div>
                <p className="text-sm" dir="ltr">
                  {m.phone}
                </p>
                {canCost ? (
                  <p className="text-sm font-bold text-slate-600">
                    {COMPENSATION_LABELS[m.defaultCompensationMethod]} ·{" "}
                    {formatOMR(m.defaultRateMilli)}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">
                    {COMPENSATION_LABELS[m.defaultCompensationMethod]}
                  </p>
                )}
                {canWrite ? (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => openEdit(m)}>
                      تعديل
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        upsertStaffMember(session, {
                          id: m.id,
                          name: m.name,
                          phone: m.phone,
                          whatsapp: m.whatsapp,
                          staffType: m.staffType,
                          defaultCompensationMethod: m.defaultCompensationMethod,
                          defaultRateMilli: m.defaultRateMilli,
                          notes: m.notes,
                          isActive: !m.isActive,
                        })
                      }
                    >
                      {m.isActive ? "تعطيل" : "تفعيل"}
                    </Button>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen} title={editing ? "تعديل موظف" : "موظف جديد"}>
        <div className="space-y-4">
          {error ? <Alert>{error}</Alert> : null}
          <Field label="الاسم">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="الهاتف">
            <Input
              dir="ltr"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="النوع">
              <Select
                value={form.staffType}
                onChange={(e) =>
                  setForm({ ...form, staffType: e.target.value as StaffType })
                }
              >
                {Object.entries(STAFF_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="طريقة التعويض">
              <Select
                value={form.defaultCompensationMethod}
                onChange={(e) =>
                  setForm({
                    ...form,
                    defaultCompensationMethod: e.target.value as CompensationMethod,
                  })
                }
              >
                {Object.entries(COMPENSATION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {canCost ? (
            <Field label="الأجر الافتراضي (ر.ع.)">
              <MoneyInput
                valueMilli={form.defaultRateMilli}
                onChangeMilli={(v) => setForm({ ...form, defaultRateMilli: v })}
              />
            </Field>
          ) : null}
          <Field label="ملاحظات">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
          <Button className="w-full" loading={saving} onClick={save}>
            حفظ
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
