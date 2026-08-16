import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import type { StaffMember, Assignment } from "../events.api";

export function TeamTab({
  staff,
  assignments,
  run,
}: {
  staff: ReadonlyArray<StaffMember>;
  assignments: ReadonlyArray<Assignment>;
  run: (name: string, args: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 font-black">إسناد موظف</h2>
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const s = staff.find((x) => x.id === f.get("staff"));
            void run("assign_event_staff", {
              p_staff_member_id: s?.id,
              p_assignment_role: s?.staff_type,
              p_compensation_method: s?.default_compensation_method ?? "PER_EVENT",
              p_rate: s?.default_rate ?? "0.000",
              p_expected_compensation: s?.default_rate ?? "0.000",
              p_notes: null,
              p_idempotency_key: crypto.randomUUID(),
            });
          }}
        >
          <Select name="staff" required>
            <option value="">اختر الموظف</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.staff_type}
              </option>
            ))}
          </Select>
          <Button type="submit">إسناد</Button>
        </form>
      </Card>
      {assignments.map((a) => (
        <Card key={a.id}>
          <p className="font-bold">
            {staff.find((s) => s.id === a.staff_member_id)?.name ?? a.staff_member_id}
          </p>
          <p className="text-sm text-slate-500">
            {a.assignment_role} · {a.status}
          </p>
        </Card>
      ))}
    </div>
  );
}
