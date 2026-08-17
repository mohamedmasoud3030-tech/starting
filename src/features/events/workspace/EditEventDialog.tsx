import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { arabicError, useUpdateEvent, type EventRow } from "../events.api";
import { isoToMuscatWallClock, muscatWallClockToIso } from "@/lib/dates";

const toLocalInputValue = isoToMuscatWallClock;

/**
 * Corrects event logistics (title, type, window, guests, venue, contacts,
 * notes) while the event is in DRAFT/QUOTED — the only states the database
 * edit policy (migration 0057) allows. Defect F12.
 */
export function EditEventDialog({
  open,
  onOpenChange,
  orgId,
  event,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  event: EventRow;
}) {
  const update = useUpdateEvent(orgId);

  const [title, setTitle] = useState(event.title);
  const [eventType, setEventType] = useState(event.event_type);
  const [startAt, setStartAt] = useState(() => toLocalInputValue(event.start_at));
  const [endAt, setEndAt] = useState(() => toLocalInputValue(event.end_at));
  const [guests, setGuests] = useState(String(event.guest_count));
  const [venue, setVenue] = useState(event.venue_name);
  const [contactName, setContactName] = useState(event.contact_name ?? "");
  const [contactPhone, setContactPhone] = useState(event.contact_phone ?? "");
  const [notes, setNotes] = useState(event.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      await update.mutateAsync({
        id: event.id,
        title,
        eventType,
        startAt: muscatWallClockToIso(startAt) ?? startAt,
        endAt: muscatWallClockToIso(endAt) ?? endAt,
        guestCount: Number(guests),
        venue,
        contactName,
        contactPhone,
        notes,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(arabicError(cause));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="تعديل بيانات المناسبة"
      description="التعديل متاح قبل التأكيد فقط — بعد التأكيد تثبت البيانات التجارية."
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="عنوان المناسبة" htmlFor="edit-title" required>
          <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="نوع المناسبة" htmlFor="edit-type">
          <Input id="edit-type" value={eventType} onChange={(e) => setEventType(e.target.value)} />
        </Field>
        <Field label="البداية" htmlFor="edit-start" required>
          <Input id="edit-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required />
        </Field>
        <Field label="النهاية" htmlFor="edit-end" required>
          <Input id="edit-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
        </Field>
        <Field label="عدد الضيوف" htmlFor="edit-guests" required>
          <Input id="edit-guests" type="number" min="1" value={guests} onChange={(e) => setGuests(e.target.value)} required />
        </Field>
        <Field label="الموقع" htmlFor="edit-venue" required>
          <Input id="edit-venue" value={venue} onChange={(e) => setVenue(e.target.value)} required />
        </Field>
        <Field label="اسم جهة الاتصال" htmlFor="edit-contact">
          <Input id="edit-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </Field>
        <Field label="هاتف جهة الاتصال" htmlFor="edit-phone">
          <Input id="edit-phone" dir="ltr" inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="ملاحظات" htmlFor="edit-notes">
            <Textarea id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        {error && (
          <p className="text-sm font-bold text-red-700 sm:col-span-2" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            إلغاء
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "جارٍ الحفظ…" : "حفظ التعديلات"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
