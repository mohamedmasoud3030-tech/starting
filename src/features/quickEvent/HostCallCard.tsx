import { useMemo, useState } from "react";
import { CheckCircle2, Copy, MessageCircle, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Assignment, EventRow, StaffMember } from "@/features/events/events.api";
import { STAFF_TYPE_LABELS } from "@/features/staff/labels";
import { pickOfferForGuests } from "./officeOffers";

const DATE_FMT = new Intl.DateTimeFormat("ar-OM", {
  timeZone: "Asia/Muscat",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const TIME_FMT = new Intl.DateTimeFormat("ar-OM", {
  timeZone: "Asia/Muscat",
  hour: "numeric",
  minute: "2-digit",
});

/** The announcement the office posts in the hosts' WhatsApp groups. */
export function buildHostCallText(ev: Pick<EventRow, "title" | "start_at" | "venue_name" | "guest_count">, orgName: string, hostsNeeded: number, supervisorsNeeded: number): string {
  const start = new Date(ev.start_at);
  return [
    `📢 إعلان مناسبة — ${orgName}`,
    ``,
    `📅 ${DATE_FMT.format(start)}`,
    `⏰ التحرك الساعة ${TIME_FMT.format(start)}`,
    `📍 ${ev.venue_name}`,
    `👥 عدد الضيوف: ${ev.guest_count}`,
    ``,
    `المطلوب: ${hostsNeeded} مضيف + ${supervisorsNeeded} ${supervisorsNeeded === 1 ? "مشرف" : "مشرفين"}`,
    ``,
    `المتاح يرسل «تأكيد» + اسمه هنا أو على الخاص.`,
    `⚠️ الحضور بالبصمة وقت التحرك ووقت الانتهاء.`,
  ].join("\n");
}

/**
 * «نداء المضيفين» — the office's real staffing flow:
 *  1. post the announcement in the WhatsApp groups (one tap copies/opens it),
 *  2. as confirmations arrive, tick the names — each tick is a real
 *     assignment (assign_event_staff) so attendance/face/payroll follow.
 */
export function HostCallCard({
  event,
  orgName,
  staff,
  assignments,
  run,
  canAssign,
}: {
  event: EventRow;
  orgName: string;
  staff: ReadonlyArray<StaffMember>;
  assignments: ReadonlyArray<Assignment>;
  run: (name: string, args: Record<string, unknown>, includeEvent?: boolean) => Promise<void>;
  canAssign: boolean;
}) {
  const offer = pickOfferForGuests(event.guest_count);
  const hostsNeeded = offer?.hosts ?? 0;
  const supervisorsNeeded = offer?.supervisors ?? 0;

  const active = assignments.filter((a) => a.status === "ACTIVE");
  const assignedIds = new Set(active.map((a) => a.staff_member_id));
  const assignedHosts = active.filter((a) => a.assignment_role !== "SUPERVISOR").length;
  const assignedSupervisors = active.filter((a) => a.assignment_role === "SUPERVISOR").length;

  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const available = useMemo(() => {
    const q = query.trim();
    return staff
      .filter((s) => s.is_active && !assignedIds.has(s.id))
      .filter((s) => !q || s.name.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [staff, assignedIds, query]);

  const text = buildHostCallText(event, orgName, hostsNeeded, supervisorsNeeded);
  const waHref = `https://wa.me/?text=${encodeURIComponent(text)}`;

  const confirm = async (s: StaffMember) => {
    setBusyId(s.id);
    try {
      await run("assign_event_staff", {
        p_staff_member_id: s.id,
        p_assignment_role: s.staff_type,
        p_compensation_method: s.default_compensation_method ?? "PER_EVENT",
        p_rate: s.default_rate ?? "0.000",
        p_expected_compensation: s.default_rate ?? "0.000",
        p_notes: "تأكيد عبر واتساب",
        p_idempotency_key: crypto.randomUUID(),
      });
    } finally {
      setBusyId(null);
    }
  };

  const hostsDone = hostsNeeded > 0 && assignedHosts >= hostsNeeded;
  const supDone = supervisorsNeeded > 0 && assignedSupervisors >= supervisorsNeeded;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6 text-brand-700" />
          <h2 className="text-lg font-black">نداء المضيفين</h2>
        </div>
        <div className="flex gap-2 text-sm font-bold">
          <span className={`rounded-lg px-3 py-1 ${hostsDone ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
            مضيفين {assignedHosts}/{hostsNeeded || "—"}
          </span>
          <span className={`rounded-lg px-3 py-1 ${supDone ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
            مشرفين {assignedSupervisors}/{supervisorsNeeded || "—"}
          </span>
        </div>
      </div>

      {/* Step 1 — announce */}
      <div className="rounded-xl bg-slate-50 p-3">
        <p className="mb-2 text-sm font-bold text-slate-600">١ · انشر الإعلان في جروبات المضيفين</p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-sm leading-6 text-slate-800">{text}</pre>
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-bold text-white hover:bg-emerald-700"
          >
            <MessageCircle className="h-5 w-5" /> افتح واتساب واختر الجروب
          </a>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            <Copy className="h-4 w-4" /> {copied ? "تم النسخ ✓" : "انسخ النص"}
          </Button>
        </div>
      </div>

      {/* Step 2 — tick confirmations */}
      {canAssign && (
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="mb-2 text-sm font-bold text-slate-600">
            ٢ · كل ما مضيف يبعت «تأكيد» — اضغط على اسمه
          </p>
          <label className="relative block">
            <Search className="pointer-events-none absolute end-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالاسم…"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white pe-10 ps-4 text-base"
            />
          </label>
          {available.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              {staff.length === 0 ? "أضف المضيفين أولاً من صفحة «المضيفون والحضور»." : "لا يوجد أسماء مطابقة أو الكل مؤكد."}
            </p>
          ) : (
            <ul className="mt-2 grid max-h-72 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">
              {available.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void confirm(s)}
                    className="flex min-h-12 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-start text-base font-bold text-slate-800 hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-60"
                  >
                    <span>
                      {s.name}
                      <span className="ms-2 text-xs font-normal text-slate-500">{STAFF_TYPE_LABELS[s.staff_type] ?? s.staff_type}</span>
                    </span>
                    {busyId === s.id ? <span className="text-xs">…</span> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {active.length > 0 && (
        <p className="text-sm text-slate-600">
          ٣ · يوم المناسبة: افتح تبويب <b>الحضور</b> → بصمة الوجه عند التحرك وعند الانتهاء. الأجر يُحسب تلقائياً.
        </p>
      )}
    </section>
  );
}
