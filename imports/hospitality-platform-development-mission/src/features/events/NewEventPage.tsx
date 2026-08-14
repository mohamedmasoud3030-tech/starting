import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "@/app/session";
import { createCustomer, createEvent, useEngine } from "@/engine/engine";
import {
  CUSTOMER_TYPE_LABELS,
  EVENT_TYPE_LABELS,
  canWriteCustomersFor,
  type CustomerType,
  type EventType,
} from "@/lib/domain";
import { errorMessage } from "@/lib/errors";
import { fromMuscatLocalInput } from "@/lib/time";
import {
  Alert,
  Button,
  Card,
  CardBody,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";

const STEPS = ["العميل", "الموعد والموقع", "التفاصيل", "مراجعة"] as const;

export function NewEventPage() {
  const { session } = useSession();
  const state = useEngine();
  const navigate = useNavigate();
  const customers = useMemo(
    () =>
      state.customers.filter(
        (c) => c.organizationId === session!.organizationId && c.status === "ACTIVE",
      ),
    [state.customers, session],
  );

  const [step, setStep] = useState(0);
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [venueName, setVenueName] = useState("");
  const [address, setAddress] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [guestCount, setGuestCount] = useState("100");
  const [eventType, setEventType] = useState<EventType>("MAJLIS");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [newCustOpen, setNewCustOpen] = useState(false);
  const [newCust, setNewCust] = useState({
    name: "",
    phone: "",
    customerType: "INDIVIDUAL" as CustomerType,
  });

  const customer = customers.find((c) => c.id === customerId);

  function next() {
    setError("");
    if (step === 0 && !customerId) {
      setError("اختر عميلاً");
      return;
    }
    if (step === 1) {
      if (!startLocal || !endLocal) {
        setError("حدد وقت البداية والنهاية");
        return;
      }
      if (!venueName.trim()) {
        setError("اسم الموقع مطلوب");
        return;
      }
    }
    if (step === 2 && Number(guestCount) < 1) {
      setError("عدد الضيوف يجب أن يكون أكبر من صفر");
      return;
    }
    setStep((s) => Math.min(3, s + 1));
  }

  function submit() {
    setSaving(true);
    setError("");
    try {
      const event = createEvent(session, {
        customerId,
        eventType,
        title: title || undefined,
        startAt: fromMuscatLocalInput(startLocal),
        endAt: fromMuscatLocalInput(endLocal),
        guestCount: Number(guestCount),
        venueName,
        address,
        mapUrl,
        notes,
        clientRequestId: crypto.randomUUID(),
      });
      navigate(`/events/${event.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="مناسبة جديدة" subtitle="أربع خطوات قصيرة ثم تُنشأ المناسبة." />

      <ol className="mb-6 grid grid-cols-4 gap-2">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`rounded-xl px-2 py-3 text-center text-sm font-bold ${
              i === step
                ? "bg-brand-700 text-white"
                : i < step
                  ? "bg-brand-100 text-brand-800"
                  : "bg-white text-slate-400"
            }`}
          >
            {label}
          </li>
        ))}
      </ol>

      <Card>
        <CardBody className="space-y-4">
          {error ? <Alert>{error}</Alert> : null}

          {step === 0 && (
            <>
              <Field label="العميل">
                <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">— اختر —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {canWriteCustomersFor(session!.role) ? (
                <Button variant="outline" onClick={() => setNewCustOpen(true)}>
                  + عميل سريع
                </Button>
              ) : null}
            </>
          )}

          {step === 1 && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="البداية (توقيت مسقط)">
                  <Input
                    type="datetime-local"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                  />
                </Field>
                <Field label="النهاية">
                  <Input
                    type="datetime-local"
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="اسم الموقع">
                <Input
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  placeholder="مجلس العائلة، قاعة..."
                />
              </Field>
              <Field label="العنوان">
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </Field>
              <Field label="رابط الخريطة (اختياري)">
                <Input
                  dir="ltr"
                  value={mapUrl}
                  onChange={(e) => setMapUrl(e.target.value)}
                />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field label="عدد الضيوف">
                <Input
                  inputMode="numeric"
                  value={guestCount}
                  onChange={(e) => setGuestCount(e.target.value)}
                />
              </Field>
              <Field label="نوع المناسبة">
                <Select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value as EventType)}
                >
                  {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="عنوان مختصر (اختياري)">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="ملاحظات">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </>
          )}

          {step === 3 && (
            <dl className="space-y-3 text-base">
              <Row k="العميل" v={customer?.name ?? "—"} />
              <Row k="النوع" v={EVENT_TYPE_LABELS[eventType]} />
              <Row k="الضيوف" v={guestCount} />
              <Row k="الموقع" v={venueName} />
              <Row k="العنوان" v={address || "—"} />
              <Row k="البداية" v={startLocal.replace("T", " ")} />
              <Row k="النهاية" v={endLocal.replace("T", " ")} />
            </dl>
          )}

          <div className="flex gap-2 pt-2">
            {step > 0 ? (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
                رجوع
              </Button>
            ) : (
              <Button variant="outline" onClick={() => navigate("/events")}>
                إلغاء
              </Button>
            )}
            {step < 3 ? (
              <Button className="flex-1" onClick={next}>
                التالي
              </Button>
            ) : (
              <Button className="flex-1" loading={saving} onClick={submit}>
                إنشاء المناسبة
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <Dialog
        open={newCustOpen}
        onOpenChange={setNewCustOpen}
        title="عميل سريع"
      >
        <div className="space-y-4">
          <Field label="الاسم">
            <Input
              value={newCust.name}
              onChange={(e) => setNewCust({ ...newCust, name: e.target.value })}
            />
          </Field>
          <Field label="الهاتف">
            <Input
              dir="ltr"
              value={newCust.phone}
              onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })}
            />
          </Field>
          <Field label="النوع">
            <Select
              value={newCust.customerType}
              onChange={(e) =>
                setNewCust({
                  ...newCust,
                  customerType: e.target.value as CustomerType,
                })
              }
            >
              {Object.entries(CUSTOMER_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            className="w-full"
            onClick={() => {
              try {
                const created = createCustomer(session, newCust);
                setCustomerId(created.id);
                setNewCustOpen(false);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            إضافة واختيار
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-bold">{v}</dd>
    </div>
  );
}
