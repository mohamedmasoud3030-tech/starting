import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarDays, MapPin, Plus, Search, Users } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TruncationNotice } from "@/components/ui/TruncationNotice";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useCustomers } from "@/features/customers/customers.api";
import { OwnerVoiceButton } from "@/features/ownerVoice/OwnerVoiceButton";
import { buildEventsListVoiceSummary } from "@/features/ownerVoice/screenSummary";
import { listIsTruncated } from "@/lib/listCap";
import { muscatWallClockToIso } from "@/lib/dates";
import { useStableIdempotencyKey } from "@/lib/useStableIdempotencyKey";
import { orderEvents, type EventListSortMode } from "./eventsListOrder";
import { arabicError, useCreateEvent, useEventsPage, type EventStatus } from "./events.api";

const labels: Record<EventStatus, string> = {
  DRAFT: "مسودة", QUOTED: "تم التسعير", CONFIRMED: "مؤكدة", PREPARING: "قيد التجهيز",
  DISPATCHED: "تم الإرسال", IN_PROGRESS: "جارية", RETURNING: "قيد الإرجاع",
  CLOSED: "مغلقة", CANCELLED: "ملغاة",
};

const tones: Record<EventStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral", QUOTED: "brand", CONFIRMED: "success", PREPARING: "warning",
  DISPATCHED: "brand", IN_PROGRESS: "success", RETURNING: "warning", CLOSED: "neutral", CANCELLED: "danger",
};

type EventFilter = "ACTIVE" | "UPCOMING" | "CLOSED" | "ALL";

export function EventsPage() {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const events = useEventsPage(orgId);
  const customers = useCustomers(orgId);
  const create = useCreateEvent(orgId);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<EventFilter>("ACTIVE");
  const [sortMode, setSortMode] = useState<EventListSortMode>("UPCOMING");
  // One idempotency key per dialog session: an ambiguous retry replays the
  // same server command instead of creating a duplicate event.
  const createKey = useStableIdempotencyKey(open);

  const customerNames = useMemo(
    () =>
      new Map(
        (customers.data?.rows ?? []).map((customer) => [
          customer.id,
          customer.name,
        ]),
      ),
    [customers.data],
  );
  const orderedEvents = useMemo(
    () => orderEvents(events.data?.rows ?? [], sortMode),
    [events.data, sortMode],
  );

  const visibleEvents = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ar");
    const now = Date.now();
    return orderedEvents.filter((event) => {
      const matchesFilter = filter === "ALL" ||
        (filter === "ACTIVE" && !["CLOSED", "CANCELLED"].includes(event.status)) ||
        (filter === "UPCOMING" && !["CLOSED", "CANCELLED"].includes(event.status) && new Date(event.start_at).getTime() >= now) ||
        (filter === "CLOSED" && ["CLOSED", "CANCELLED"].includes(event.status));
      const haystack = `${event.event_number} ${event.title} ${event.venue_name} ${customerNames.get(event.customer_id) ?? ""}`.toLocaleLowerCase("ar");
      return matchesFilter && (!term || haystack.includes(term));
    });
  }, [customerNames, orderedEvents, filter, search]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const event = await create.mutateAsync({
        customerId: String(form.get("customer")), title: String(form.get("title")),
        eventType: String(form.get("type")),
        startAt: muscatWallClockToIso(String(form.get("start"))) ?? String(form.get("start")),
        endAt: muscatWallClockToIso(String(form.get("end"))) ?? String(form.get("end")),
        guestCount: Number(form.get("guests")),
        venue: String(form.get("venue")), contactName: String(form.get("contact") ?? ""),
        contactPhone: String(form.get("phone") ?? ""), notes: String(form.get("notes") ?? ""),
        idempotencyKey: createKey,
      });
      setOpen(false);
      void navigate({ to: "/events/$eventId", params: { eventId: event.id } });
    } catch (cause) {
      setError(arabicError(cause));
    }
  }

  const voiceSummary = events.isSuccess
    ? buildEventsListVoiceSummary({ events: events.data?.rows ?? [] })
    : null;
  const eventsTruncated =
    events.isSuccess && (events.hasMore || listIsTruncated(events.data?.rows.length ?? 0, events.data?.total));

  return (
    <div>
      <PageHeader
        title="المناسبات"
        description="جدول التنفيذ من التأكيد حتى الإغلاق، مع العميل والموقع والحالة في نظرة واحدة"
        actions={<><OwnerVoiceButton summary={voiceSummary} /><Button onClick={() => setOpen(true)}><Plus className="h-5 w-5" />مناسبة جديدة</Button></>}
      />

      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">البحث في المناسبات</span>
          <Search className="pointer-events-none absolute right-3 top-3.5 h-5 w-5 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10" placeholder="ابحث بالرقم، المناسبة، العميل أو الموقع" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label="ترتيب المناسبات">
          <button type="button" onClick={() => setSortMode("UPCOMING")} aria-pressed={sortMode === "UPCOMING"}
            className={`min-h-11 shrink-0 rounded-xl px-3 text-sm font-bold ${sortMode === "UPCOMING" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            القادمة أولاً
          </button>
          <button type="button" onClick={() => setSortMode("CHRONO")} aria-pressed={sortMode === "CHRONO"}
            className={`min-h-11 shrink-0 rounded-xl px-3 text-sm font-bold ${sortMode === "CHRONO" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            ترتيب زمني
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label="تصفية المناسبات">
          {([['ACTIVE','النشطة'],['UPCOMING','القادمة'],['CLOSED','المغلقة'],['ALL','الكل']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value}
              className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-bold ${filter === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {label}
            </button>
          ))}
        </div>
        </div>
      </div>

      {eventsTruncated && (
        <div className="mb-4 space-y-3">
          <TruncationNotice
            message={`يتم عرض ${events.data?.rows.length ?? 0} من ${events.data?.total ?? "…"} مناسبة. اعرض المزيد حتى تكتمل القائمة.`}
          />
          {events.hasMore && (
            <Button
              variant="secondary"
              onClick={() => events.loadMore()}
              disabled={events.isFetching}
            >
              {events.isFetching ? "جارٍ التحميل…" : "عرض المزيد من المناسبات"}
            </Button>
          )}
        </div>
      )}

      {events.isLoading ? <p className="py-12 text-center text-slate-500">جارٍ تحميل المناسبات…</p> :
        !events.data?.rows.length ? <EmptyState title="لا توجد مناسبات" description="أنشئ أول مناسبة لبدء التخطيط." action={<Button onClick={() => setOpen(true)}>+ مناسبة جديدة</Button>} /> :
        visibleEvents.length === 0 ? <EmptyState title="لا توجد نتائج مطابقة" description="غيّر عبارة البحث أو عامل التصفية." /> :
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_auto] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm font-bold text-slate-500 md:grid">
            <span>المناسبة والعميل</span><span>الموعد</span><span>الموقع والضيوف</span><span>الحالة</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {visibleEvents.map((event) => (
              <li key={event.id}>
                <button type="button" onClick={() => void navigate({ to: "/events/$eventId", params: { eventId: event.id } })}
                  className="grid min-h-24 w-full gap-3 px-4 py-4 text-right transition hover:bg-slate-50 focus-visible:bg-slate-50 md:grid-cols-[minmax(0,1.5fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_auto] md:items-center md:px-5">
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-3 md:block">
                      <p className="truncate text-base font-black text-slate-900">{event.title}</p>
                      <Badge tone={tones[event.status]} className="md:hidden">{labels[event.status]}</Badge>
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-500"><span dir="ltr">{event.event_number}</span> · {customerNames.get(event.customer_id) ?? "عميل"}</p>
                  </div>
                  <p className="flex items-center gap-2 text-sm text-slate-700"><CalendarDays className="h-4 w-4 text-slate-400" />{new Date(event.start_at).toLocaleString("ar-OM", { timeZone: "Asia/Muscat", dateStyle: "medium", timeStyle: "short" })}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 md:block">
                    <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-slate-400" />{event.venue_name}</p>
                    <p className="mt-1 flex items-center gap-2"><Users className="h-4 w-4 text-slate-400" />{event.guest_count} ضيف</p>
                  </div>
                  <Badge tone={tones[event.status]} className="hidden justify-self-end md:inline-flex">{labels[event.status]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>}

      <Dialog open={open} onOpenChange={setOpen} title="مناسبة جديدة" description="أنشئ مناسبة مباشرة لعميل مسجل. عروض العملاء المتوقعين تبدأ من شاشة عروض الأسعار.">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="العميل"><Select name="customer" required defaultValue=""><option value="" disabled>اختر العميل</option>{customers.data?.rows.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="عنوان المناسبة"><Input name="title" required /></Field>
          <Field label="نوع المناسبة"><Input name="type" placeholder="زفاف، مؤتمر…" required /></Field>
          <Field label="عدد الضيوف"><Input name="guests" type="number" min="1" required /></Field>
          <Field label="البداية"><Input name="start" type="datetime-local" required /></Field>
          <Field label="النهاية"><Input name="end" type="datetime-local" required /></Field>
          <Field label="الموقع"><Input name="venue" required /></Field>
          <Field label="اسم جهة الاتصال"><Input name="contact" /></Field>
          <Field label="هاتف التواصل"><Input name="phone" inputMode="tel" /></Field>
          <div className="sm:col-span-2"><Field label="ملاحظات"><Textarea name="notes" /></Field></div>
          {error && <p className="sm:col-span-2 text-sm font-bold text-red-700" role="alert">{error}</p>}
          <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 bg-white py-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "جارٍ الإنشاء…" : "إنشاء المناسبة"}</Button></div>
        </form>
      </Dialog>
    </div>
  );
}
