import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, MessageCircle, Sparkles } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { toOMRString } from "@/lib/money";
import { omanWhatsAppUrl } from "@/lib/phone";
import { arabicQuotationError } from "@/features/quotes/quotes.api";
import {
  DEPOSIT_PERCENT,
  OFFICE_OFFERS,
  buildOfferWhatsAppText,
  depositMilli,
  describeOffer,
  pickOfferForGuests,
  type OfficeOffer,
} from "./officeOffers";
import { useCreateQuickEvent, useOfferSeedStatus, useSeedOfficeOffers, type QuickEventResult } from "./quickEvent.api";

function defaultStart(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(18, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function arabicDateLabel(wallClock: string): string {
  const d = new Date(wallClock);
  if (Number.isNaN(d.getTime())) return wallClock;
  return new Intl.DateTimeFormat("ar-OM", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/**
 * «مناسبة سريعة» — the office's real daily flow in ONE screen:
 * customer + phone + date + place + guests → the printed offer tier is picked
 * automatically → one tap creates the issued quotation + confirmed event and
 * prepares the WhatsApp message for the customer.
 */
export function QuickEventDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const navigate = useNavigate();

  const seedStatus = useOfferSeedStatus(orgId);
  const seed = useSeedOfficeOffers(orgId);
  const create = useCreateQuickEvent(orgId);

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [startAt, setStartAt] = useState(defaultStart);
  const [venue, setVenue] = useState("");
  const [guestsText, setGuestsText] = useState("");
  const [outsideNizwa, setOutsideNizwa] = useState(false);
  const [notes, setNotes] = useState("");
  const [manualTier, setManualTier] = useState<number | null>(null);
  const [result, setResult] = useState<QuickEventResult | null>(null);

  const guests = Number.parseInt(guestsText, 10);
  const autoOffer = useMemo(() => pickOfferForGuests(guests), [guests]);
  const offer: OfficeOffer | null = manualTier
    ? (OFFICE_OFFERS.find((o) => o.tier === manualTier) ?? autoOffer)
    : autoOffer;

  const nameOk = customerName.trim().length >= 2;
  const venueOk = venue.trim().length >= 2;
  const guestsOk = Number.isFinite(guests) && guests > 0;
  const canSubmit = nameOk && venueOk && guestsOk && !!offer && !create.isPending;

  const reset = () => {
    setCustomerName("");
    setPhone("");
    setStartAt(defaultStart());
    setVenue("");
    setGuestsText("");
    setOutsideNizwa(false);
    setNotes("");
    setManualTier(null);
    setResult(null);
    create.reset();
  };

  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const submit = async () => {
    if (!offer || !canSubmit) return;
    if (seedStatus.data && !seedStatus.data.seeded && !seed.isPending) {
      // First use: put the printed offers into the catalog/packages so the
      // rest of the app (packages page, documents) knows them.
      try {
        await seed.mutateAsync();
      } catch {
        /* seeding is a convenience; the quick event still works */
      }
    }
    const r = await create.mutateAsync({
      customerName,
      phone,
      startAt,
      durationHours: 5,
      venue,
      guests,
      offer,
      outsideNizwa,
      notes,
    });
    setResult(r);
  };

  const whatsappHref = useMemo(() => {
    if (!result || !offer) return null;
    const base = omanWhatsAppUrl(phone);
    if (!base) return null;
    const text = buildOfferWhatsAppText({
      customerName: customerName.trim(),
      offer,
      guests,
      dateLabel: arabicDateLabel(startAt),
      venue: venue.trim(),
      eventNumber: result.quotationNumber,
      orgName: currentOrganization?.name ?? "",
    });
    return `${base}?text=${encodeURIComponent(text)}`;
  }, [result, offer, phone, customerName, guests, startAt, venue, currentOrganization?.name]);

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={result ? "تم إنشاء المناسبة" : "مناسبة سريعة"}
      description={result ? undefined : "اكتب عدد الضيوف والتطبيق يختار العرض المناسب من عروض المكتب"}
      className="sm:max-w-xl"
    >
      {result ? (
        <div className="space-y-5 pb-4">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0 text-emerald-700" />
            <div>
              <p className="text-lg font-black text-emerald-900">
                {offer?.name} — {offer ? toOMRString(offer.priceMilli) : ""} ر.ع
              </p>
              <p className="mt-1 text-base text-emerald-800">
                المناسبة مؤكدة وعرض السعر صادر{result.quotationNumber ? ` (${result.quotationNumber})` : ""}.
                العربون المطلوب: <b>{offer ? toOMRString(depositMilli(offer.priceMilli)) : ""} ر.ع</b>
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            {whatsappHref ? (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 text-lg font-bold text-white hover:bg-emerald-700"
              >
                <MessageCircle className="h-6 w-6" />
                أرسل التفاصيل للعميل واتساب
              </a>
            ) : (
              <p className="rounded-xl bg-slate-50 p-3 text-center text-slate-500">
                أدخل رقم هاتف عُماني صحيح لتفعيل زر الواتساب.
              </p>
            )}
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                close(false);
                void navigate({ to: "/events/$eventId", params: { eventId: result.eventId } });
              }}
            >
              افتح المناسبة (الفريق · المعدات · العربون)
            </Button>
            <Button size="lg" variant="ghost" onClick={reset}>
              مناسبة أخرى
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم العميل" htmlFor="qe-name" required>
              <Input id="qe-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="مثال: سالم البوسعيدي" autoFocus />
            </Field>
            <Field label="رقم الهاتف" htmlFor="qe-phone" hint="8 أرقام — للواتساب">
              <Input id="qe-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9XXXXXXX" />
            </Field>
            <Field label="موعد المناسبة" htmlFor="qe-start" required>
              <Input id="qe-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </Field>
            <Field label="المكان" htmlFor="qe-venue" required>
              <Input id="qe-venue" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="مثال: قاعة … / منزل العائلة" />
            </Field>
          </div>

          <Field label="عدد الضيوف" htmlFor="qe-guests" required>
            <Input
              id="qe-guests"
              inputMode="numeric"
              value={guestsText}
              onChange={(e) => {
                setGuestsText(e.target.value.replace(/[^\d]/g, ""));
                setManualTier(null);
              }}
              placeholder="مثال: 350"
              className="h-16 text-center text-3xl font-black"
            />
          </Field>

          {offer ? (
            <div className="rounded-2xl border-2 border-brand-300 bg-brand-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-6 w-6 text-brand-700" />
                  <p className="text-xl font-black text-brand-900">{offer.name}</p>
                </div>
                <p className="text-2xl font-black text-brand-900">{toOMRString(offer.priceMilli)} ر.ع</p>
              </div>
              <p className="mt-2 text-base text-brand-900/80">{describeOffer(offer)}</p>
              <p className="mt-1 text-sm text-brand-900/70">
                يناسب {offer.minGuests}–{offer.maxGuests} شخص · العربون {DEPOSIT_PERCENT}% = {toOMRString(depositMilli(offer.priceMilli))} ر.ع
              </p>
              {guests > offer.maxGuests && (
                <p className="mt-2 rounded-lg bg-amber-100 p-2 text-sm font-bold text-amber-900">
                  العدد أكبر من أعلى عرض — راجع التسعير يدوياً بعد الإنشاء.
                </p>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-bold text-brand-800">اختيار عرض آخر يدوياً</summary>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {OFFICE_OFFERS.map((o) => (
                    <button
                      key={o.tier}
                      type="button"
                      onClick={() => setManualTier(o.tier)}
                      className={
                        o.tier === offer.tier
                          ? "rounded-lg bg-brand-700 px-2 py-2 text-sm font-bold text-white"
                          : "rounded-lg border border-brand-300 bg-white px-2 py-2 text-sm font-bold text-brand-900 hover:bg-brand-100"
                      }
                    >
                      {o.tier}
                      <span className="block text-xs font-normal">{toOMRString(o.priceMilli).replace(".000", "")}</span>
                    </button>
                  ))}
                </div>
              </details>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-300 p-4 text-center text-slate-500">
              اكتب عدد الضيوف ليظهر العرض المناسب وسعره
            </p>
          )}

          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4">
            <input type="checkbox" className="h-5 w-5" checked={outsideNizwa} onChange={(e) => setOutsideNizwa(e.target.checked)} />
            <span className="text-base">المناسبة خارج ولاية نزوى (تضاف رسوم نقل)</span>
          </label>

          <Field label="ملاحظات (اختياري)" htmlFor="qe-notes">
            <Input id="qe-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="أي طلب خاص من العميل" />
          </Field>

          {create.error ? (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-base font-bold text-red-800">
              {arabicQuotationError(create.error)}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
            {create.isPending || seed.isPending ? "جارٍ الإنشاء…" : "أنشئ المناسبة وجهّز رسالة العميل"}
          </Button>
          <p className="text-center text-sm text-slate-500">
            سيُنشأ عرض سعر صادر + مناسبة مؤكدة + العميل في السجل — كل شيء بضغطة واحدة.
          </p>
        </form>
      )}
    </Dialog>
  );
}
