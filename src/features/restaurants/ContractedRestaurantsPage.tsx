import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  HandPlatter,
  Plus,
  ShieldAlert,
  SquareX,
  UtensilsCrossed,
} from "lucide-react";
import { useAuth } from "@/app/authContext";
import { useEvents } from "@/features/events/events.api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { Textarea } from "@/components/ui/Textarea";
import { formatServiceDate, mealPriceLabel, restaurantErrorMessage } from "./presentation";
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_TONES, CONTRACT_STATUS_LABELS, MEAL_TYPE_LABELS } from "./presentation";
import {
  cancelMealBooking,
  confirmMealBooking,
  createContract,
  createMealBooking,
  endContract,
  listCateringRestaurants,
  listContracts,
  listMealBookings,
  markMealBookingServed,
  type NewBookingInput,
  type NewContractInput,
} from "./restaurants.db";
import type { ContractSummary, MealBookingSummary, RestaurantSupplier } from "./types";

function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

interface LoadedData {
  restaurants: RestaurantSupplier[];
  contracts: ContractSummary[];
  bookings: MealBookingSummary[];
}

export function ContractedRestaurantsPage() {
  const { currentOrganization, canReadCost, currentRole } = useAuth();
  const orgId = currentOrganization?.id ?? "";
  const eventsQuery = useEvents(orgId || null);
  const isManager = currentRole === "OWNER" || currentRole === "MANAGER";

  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  const [showContractDialog, setShowContractDialog] = useState(false);
  const [showBookingDialog, setShowBookingDialog] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<MealBookingSummary | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{
    message: string;
    run: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let current = true;
    setLoading(true);
    setError("");
    void Promise.all([
      listCateringRestaurants(orgId),
      listContracts(orgId),
      listMealBookings(orgId),
    ])
      .then(([restaurants, contracts, bookings]) => {
        if (current) setData({ restaurants, contracts, bookings });
      })
      .catch((cause) => {
        if (current) setError(restaurantErrorMessage(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [orgId, reload]);

  const activeContractBySupplier = useMemo(() => {
    const map = new Map<string, ContractSummary>();
    for (const contract of data?.contracts ?? []) {
      if (contract.status === "ACTIVE" && !map.has(contract.supplier_id)) {
        map.set(contract.supplier_id, contract);
      }
    }
    return map;
  }, [data?.contracts]);

  const contractRestaurants = useMemo(
    () => (data?.restaurants ?? []).filter((r) => activeContractBySupplier.has(r.supplier_id)),
    [data?.restaurants, activeContractBySupplier],
  );
  const uncoveredRestaurants = useMemo(
    () => (data?.restaurants ?? []).filter((r) => !activeContractBySupplier.has(r.supplier_id)),
    [data?.restaurants, activeContractBySupplier],
  );

  if (!orgId || !currentOrganization) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-lg font-bold text-slate-600">اختر منظمة لعرض المطاعم المتعاقدة.</p>
      </div>
    );
  }
  if (!canReadCost) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-slate-300" aria-hidden="true" />
        <p className="mt-3 text-lg font-bold text-slate-600">
          المطاعم المتعاقدة متاحة للصلاحيات المالية فقط.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          دورك الحالي لا يشمل الاطلاع على عقود المطاعم وحجوزات الوجبات.
        </p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-72 items-center justify-center gap-3" aria-busy="true">
        <Spinner className="h-8 w-8" />
        <span className="text-lg font-bold text-slate-600">جارٍ تحميل المطاعم المتعاقدة…</span>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">
        <h1 className="text-xl font-black">تعذّر فتح قسم المطاعم المتعاقدة</h1>
        <p className="mt-1 font-semibold">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => setReload((v) => v + 1)}>
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  const bookings = data?.bookings ?? [];
  const pendingCount = bookings.filter((b) => b.status === "PENDING").length;
  const confirmedCount = bookings.filter((b) => b.status === "CONFIRMED").length;
  const activeContractCount = contractRestaurants.length;

  const runBusy = async (run: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await run();
      setConfirmTarget(null);
      setCancelTarget(null);
      setShowBookingDialog(false);
      setShowContractDialog(false);
      setReload((v) => v + 1);
    } catch (cause) {
      setError(restaurantErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="space-y-6" aria-labelledby="restaurants-title">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="restaurants-title" className="flex items-center gap-2 text-lg font-black sm:text-xl">
            <UtensilsCrossed className="h-8 w-8 text-brand-700" aria-hidden="true" />
            المطاعم المتعاقدة
          </h1>
          <p className="mt-1 text-lg text-slate-600">
            عقود المطاعم لوجبات الفعاليات وحجوزات الغداء والعشاء بنظام الحجز المسبق.
          </p>
        </div>
        {isManager && (
          <div className="flex gap-2">
            <Button onClick={() => setShowContractDialog(true)} disabled={busy}>
              <Plus className="h-5 w-5" aria-hidden="true" />
              عقد جديد
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowBookingDialog(true)}
              disabled={busy || activeContractCount === 0}
            >
              <HandPlatter className="h-5 w-5" aria-hidden="true" />
              حجز وجبة
            </Button>
          </div>
        )}
      </header>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-semibold text-red-800">
          {error}
        </div>
      ) : null}

      {/* Quick posture */}
      <section aria-label="ملخص" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
          <p className="text-sm text-slate-500">عقود سارية</p>
          <p className="mt-1 text-2xl font-black text-brand-700">{activeContractCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
          <p className="text-sm text-slate-500">حجوزات قيد التأكيد</p>
          <p className="mt-1 text-2xl font-black text-amber-600">{pendingCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
          <p className="text-sm text-slate-500">حجوزات مؤكدة</p>
          <p className="mt-1 text-2xl font-black text-emerald-700">{confirmedCount}</p>
        </div>
      </section>

      {isManager && uncoveredRestaurants.length > 0 ? (
        <section aria-label="مطاعم دون عقد سارٍ" className="rounded-2xl border border-dashed border-brand-300 bg-brand-50/50 p-4">
          <p className="font-bold text-brand-800">
            مطاعم متعاقدة بلا عقد سارٍ ({uncoveredRestaurants.length}):
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {uncoveredRestaurants.map((restaurant) => (
              <span
                key={restaurant.supplier_id}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm"
              >
                {restaurant.name}
                <button
                  type="button"
                  className="font-bold text-brand-700 hover:text-brand-900"
                  onClick={() => setShowContractDialog(true)}
                >
                  إضافة عقد
                </button>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {/* Contracts */}
      <section aria-labelledby="contracts-heading">
        <h2 id="contracts-heading" className="mb-3 text-xl font-black">
          العقود
        </h2>
        {data && (data.contracts.length > 0 || contractRestaurants.length > 0) ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {(data?.contracts ?? [])
              .slice()
              .sort((a) => (a.status === "ACTIVE" ? -1 : 1))
              .map((contract) => {
                const ended = contract.status === "ENDED";
                return (
                  <article
                    key={contract.contract_id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-slate-900">{contract.supplier_name}</p>
                        <p className="text-sm text-slate-500">
                          العقد {contract.contract_number} · {formatServiceDate(contract.starts_on)} →{" "}
                          {formatServiceDate(contract.ends_on)}
                        </p>
                      </div>
                      <Badge tone={ended ? "neutral" : "brand"}>
                        {CONTRACT_STATUS_LABELS[contract.status]}
                      </Badge>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-slate-500">غداء (للفرد)</dt>
                        <dd className="mt-0.5 font-black text-slate-900">{mealPriceLabel(contract.lunch_unit_price)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">عشاء (للفرد)</dt>
                        <dd className="mt-0.5 font-black text-slate-900">{mealPriceLabel(contract.dinner_unit_price)}</dd>
                      </div>
                      {contract.minimum_guests > 0 ? (
                        <div>
                          <dt className="text-slate-500">حد أدنى للضيوف</dt>
                          <dd className="mt-0.5 font-bold">{contract.minimum_guests}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt className="text-slate-500">مهلة التأكيد</dt>
                        <dd className="mt-0.5 font-bold">{contract.cut_off_hours} ساعة</dd>
                      </div>
                    </dl>
                    {contract.payment_terms ? (
                      <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        شروط الدفع: {contract.payment_terms}
                      </p>
                    ) : null}
                    {isManager && !ended ? (
                      <div className="mt-3 flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            setConfirmTarget({
                              message: `إنهاء العقد ${contract.contract_number} مع «${contract.supplier_name}»؟ لن تُقبل حجوزات جديدة بعدها.`,
                              run: () => endContract(orgId, contract.contract_id),
                            })
                          }
                        >
                          إنهاء العقد
                        </Button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
          </div>
        ) : (
          <EmptyState
            title="لا توجد عقود بعد"
            description={
              isManager
                ? "أضف مطعمك المتعاقد الأول بسعرَي الغداء والعشاء ليظهر قسم المطاعم المتعاقدة."
                : "لم تُسجَّل عقود مطاعم بعد في هذه المنشأة."
            }
          />
        )}
      </section>

      {/* Bookings */}
      <section aria-labelledby="bookings-heading">
        <h2 id="bookings-heading" className="mb-3 text-xl font-black">
          حجوزات وجبات الفعاليات
        </h2>
        {bookings.length === 0 ? (
          <EmptyState
            title="لا توجد حجوزات وجبات"
            description="احجز غداء أو عشاء فعالية عند مطعم متعاقد لتحفظ السعر والكمية ويظهر الأثر مالياً."
          />
        ) : (
          <div className="space-y-3">
            {bookings.map((booking) => {
              const canMutate = isManager && (booking.status === "PENDING" || booking.status === "CONFIRMED");
              return (
                <article
                  key={booking.booking_id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-black text-slate-900">
                        {booking.event_title}
                        <span className="ms-2 text-sm font-bold text-slate-400">
                          {booking.event_number}
                        </span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="h-4 w-4" aria-hidden="true" />
                          {formatServiceDate(booking.service_date)}
                        </span>
                        <span className="font-bold">
                          {MEAL_TYPE_LABELS[booking.meal_type]} · {booking.guest_count} ضيف
                        </span>
                        <span>{booking.supplier_name}</span>
                      </p>
                      {booking.menu_summary ? (
                        <p className="mt-1 text-sm text-slate-500">{booking.menu_summary}</p>
                      ) : null}
                      {booking.status === "CANCELLED" && booking.cancellation_reason ? (
                        <p className="mt-1 text-sm font-semibold text-red-700">
                          سبب الإلغاء: {booking.cancellation_reason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={BOOKING_STATUS_TONES[booking.status]}>
                        {BOOKING_STATUS_LABELS[booking.status]}
                      </Badge>
                      <p className="text-lg font-black text-slate-900">
                        {mealPriceLabel(booking.total_amount)}
                      </p>
                    </div>
                  </div>
                  {canMutate ? (
                    <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                      {booking.status === "PENDING" ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            setConfirmTarget({
                              message: `تأكيد حجز ${MEAL_TYPE_LABELS[booking.meal_type]} لـ«${booking.event_title}» (${booking.guest_count} ضيف) عند «${booking.supplier_name}»؟`,
                              run: () => confirmMealBooking(orgId, booking.booking_id),
                            })
                          }
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          تأكيد الحجز
                        </Button>
                      ) : booking.status === "CONFIRMED" ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            setConfirmTarget({
                              message: `تسجيل وجبة «${booking.event_title}» كمنجزة بعد تقديمها؟`,
                              run: () => markMealBookingServed(orgId, booking.booking_id),
                            })
                          }
                        >
                          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                          تم التقديم
                        </Button>
                      ) : null}
                      {booking.status === "PENDING" || booking.status === "CONFIRMED" ? (
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => setCancelTarget(booking)}>
                          <SquareX className="h-4 w-4" aria-hidden="true" />
                          إلغاء
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Dialogs */}
      {isManager ? (
        <>
          <ContractDialog
            open={showContractDialog}
            restaurants={uncoveredRestaurants}
            onClose={() => setShowContractDialog(false)}
            onSubmit={(input) => runBusy(() => createContract(orgId, input))}
            busy={busy}
          />
          <BookingDialog
            key={String(showBookingDialog)}
            open={showBookingDialog}
            events={(eventsQuery.data?.rows ?? []) as unknown as Array<{ id: string; title: string; event_number: string }>}
            suppliers={contractRestaurants}
            onClose={() => setShowBookingDialog(false)}
            onSubmit={(input) => runBusy(() => createMealBooking(orgId, input))}
            busy={busy}
          />
        </>
      ) : null}

      <CancelDialog
        booking={cancelTarget}
        busy={busy}
        onClose={() => setCancelTarget(null)}
        onSubmit={(reason) => runBusy(() => cancelMealBooking(orgId, cancelTarget!.booking_id, reason))}
      />

      <ConfirmDialog target={confirmTarget} busy={busy} onClose={() => setConfirmTarget(null)} />
    </main>
  );
}

/* ------------------------- dialogs ------------------------- */

function ContractDialog({
  open,
  restaurants,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  restaurants: RestaurantSupplier[];
  onClose: () => void;
  onSubmit: (input: NewContractInput) => Promise<void>;
  busy: boolean;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [startsOn, setStartsOn] = useState(todayIso());
  const [endsOn, setEndsOn] = useState("");
  const [lunch, setLunch] = useState("");
  const [dinner, setDinner] = useState("");
  const [minimumGuests, setMinimumGuests] = useState("0");
  const [cutOff, setCutOff] = useState("24");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError("");
    const selected = restaurants.find((r) => r.supplier_id === supplierId);
    if (!selected) {
      setLocalError("اختر المطعم المتعاقد.");
      return;
    }
    const contractNo = contractNumber.trim() || `CTR-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    if (!startsOn || !endsOn || endsOn < startsOn) {
      setLocalError("تحقق من تاريخي بداية ونهاية العقد.");
      return;
    }
    if (lunch === "" || dinner === "") {
      setLocalError("أدخل سعرَي الغداء والعشاء للفرد.");
      return;
    }
    void onSubmit({
      supplierId,
      contractNumber: contractNo,
      startsOn,
      endsOn,
      lunchUnitPriceInput: lunch,
      dinnerUnitPriceInput: dinner,
      minimumGuests: Number(minimumGuests) || 0,
      cutOffHours: Number(cutOff) || 24,
      paymentTerms,
      notes,
    }).catch((cause) => setLocalError(restaurantErrorMessage(cause)));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="عقد مطعم متعاقد جديد">
      <form onSubmit={submit} className="space-y-4">
        <Field label="المطعم" htmlFor="rest-contract-supplier" required>
          <Select
            id="rest-contract-supplier"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            required
          >
            <option value="" disabled>
              اختر المطعم
            </option>
            {restaurants.map((restaurant) => (
              <option key={restaurant.supplier_id} value={restaurant.supplier_id}>
                {restaurant.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="رقم العقد" htmlFor="rest-contract-no">
            <Input
              id="rest-contract-no"
              value={contractNumber}
              onChange={(e) => setContractNumber(e.target.value)}
              placeholder="مثال: CTR-2026-005"
            />
          </Field>
          <Field label="مهلة التأكيد (ساعة)" htmlFor="rest-contract-cutoff">
            <Input
              id="rest-contract-cutoff"
              type="number"
              value={cutOff}
              onChange={(e) => setCutOff(e.target.value)}
              inputMode="numeric"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="بداية العقد" htmlFor="rest-contract-start" required>
            <Input id="rest-contract-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
          </Field>
          <Field label="نهاية العقد" htmlFor="rest-contract-end" required>
            <Input id="rest-contract-end" type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="سعر الغداء للفرد (ر.ع.)" htmlFor="rest-contract-lunch" required>
            <Input id="rest-contract-lunch" value={lunch} onChange={(e) => setLunch(e.target.value)} placeholder="3.500" inputMode="decimal" required />
          </Field>
          <Field label="سعر العشاء للفرد (ر.ع.)" htmlFor="rest-contract-dinner" required>
            <Input id="rest-contract-dinner" value={dinner} onChange={(e) => setDinner(e.target.value)} placeholder="5.000" inputMode="decimal" required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="حد أدنى للضيوف" htmlFor="rest-contract-min">
            <Input id="rest-contract-min" type="number" value={minimumGuests} onChange={(e) => setMinimumGuests(e.target.value)} inputMode="numeric" />
          </Field>
          <div className="flex items-end">
            <p className="text-sm text-slate-500">يُحتسب سعر الحجز تلقائياً من هذا العقد.</p>
          </div>
        </div>
        <Field label="شروط الدفع" htmlFor="rest-contract-payment">
          <Input id="rest-contract-payment" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="مثال: 30 يوماً من تاريخ الفاتورة" />
        </Field>
        <Field label="ملاحظات" htmlFor="rest-contract-notes">
          <Textarea id="rest-contract-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        {localError ? (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {localError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "حفظ العقد"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function BookingDialog({
  open,
  events,
  suppliers,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  events: Array<{ id: string; title: string; event_number: string }>;
  suppliers: RestaurantSupplier[];
  onClose: () => void;
  onSubmit: (input: NewBookingInput) => Promise<void>;
  busy: boolean;
}) {
  const [eventId, setEventId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [mealType, setMealType] = useState<"LUNCH" | "DINNER">("DINNER");
  const [serviceDate, setServiceDate] = useState(todayIso());
  const [guestCount, setGuestCount] = useState("");
  const [menuSummary, setMenuSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError("");
    if (!eventId) {
      setLocalError("اختر الفعالية.");
      return;
    }
    if (!supplierId) {
      setLocalError("اختر المطعم المتعاقد.");
      return;
    }
    const guests = Number(guestCount);
    if (!Number.isInteger(guests) || guests <= 0) {
      setLocalError("أدخل عدد الضيوف (عدداً صحيحاً أكبر من صفر).");
      return;
    }
    void onSubmit({
      eventId,
      supplierId,
      mealType,
      serviceDate,
      guestCount: guests,
      menuSummary,
      notes,
    }).catch((cause) => setLocalError(restaurantErrorMessage(cause)));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="حجز وجبة فعالية" description="يُحتسب سعر الفرد والدفعة تلقائياً من العقد الساري للمطعم.">
      <form onSubmit={submit} className="space-y-4">
        {suppliers.length === 0 ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            لا يوجد عقد سارٍ لأي مطعم بعد — أنشئ عقداً أولاً ليظهر هنا.
          </p>
        ) : null}
        <Field label="الفعالية" htmlFor="rest-book-event" required>
          <Select id="rest-book-event" value={eventId} onChange={(e) => setEventId(e.target.value)} required>
            <option value="" disabled>
              اختر الفعالية
            </option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} ({event.event_number})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="المطعم المتعاقد" htmlFor="rest-book-supplier" required>
            <Select id="rest-book-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required disabled={suppliers.length === 0}>
              <option value="" disabled>
                اختر المطعم
              </option>
              {suppliers.map((s) => (
                <option key={s.supplier_id} value={s.supplier_id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الوجبة" htmlFor="rest-book-meal" required>
            <Select id="rest-book-meal" value={mealType} onChange={(e) => setMealType(e.target.value as "LUNCH" | "DINNER")} required>
              <option value="DINNER">{MEAL_TYPE_LABELS.DINNER}</option>
              <option value="LUNCH">{MEAL_TYPE_LABELS.LUNCH}</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="تاريخ الخدمة" htmlFor="rest-book-date" required>
            <Input id="rest-book-date" type="date" value={serviceDate} min={todayIso()} onChange={(e) => setServiceDate(e.target.value)} required />
          </Field>
          <Field label="عدد الضيوف" htmlFor="rest-book-guests" required>
            <Input id="rest-book-guests" type="number" min={1} value={guestCount} onChange={(e) => setGuestCount(e.target.value)} placeholder="مثال: 80" inputMode="numeric" required />
          </Field>
        </div>
        <Field label="محتوى الوجبة" htmlFor="rest-book-menu">
          <Input id="rest-book-menu" value={menuSummary} onChange={(e) => setMenuSummary(e.target.value)} placeholder="مثال: بوفيه مفتوح بدون مأكولات بحرية" />
        </Field>
        <Field label="ملاحظات" htmlFor="rest-book-notes">
          <Textarea id="rest-book-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        {localError ? (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {localError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "حجز (قيد التأكيد)"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelDialog({
  booking,
  busy,
  onClose,
  onSubmit,
}: {
  booking: MealBookingSummary | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError("");
    if (!reason.trim()) {
      setLocalError("أدخل سبب الإلغاء (إلزامي).");
      return;
    }
    void onSubmit(reason).catch((cause) => setLocalError(restaurantErrorMessage(cause)));
  };

  return (
    <Dialog open={booking !== null} onOpenChange={(o) => !o && onClose()} title="إلغاء حجز وجبة">
      {booking ? (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm leading-7 text-slate-600">
            إلغاء حجز {MEAL_TYPE_LABELS[booking.meal_type]} لفعالية «{booking.event_title}» عند «{booking.supplier_name}».
            سجّل سبباً واضحاً للرجوع إليه.
          </p>
          <Field label="سبب الإلغاء" htmlFor="rest-cancel-reason" required>
            <Textarea id="rest-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required />
          </Field>
          {localError ? (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {localError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              تراجع
            </Button>
            <Button type="submit" variant="danger" disabled={busy}>
              {busy ? "جارٍ الإلغاء…" : "تأكيد الإلغاء"}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

function ConfirmDialog({
  target,
  busy,
  onClose,
}: {
  target: { message: string; run: () => Promise<void> } | null;
  busy: boolean;
  onClose: () => void;
}) {
  const [localError, setLocalError] = useState("");
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()} title="تأكيد الإجراء">
      {target ? (
        <div className="space-y-4">
          <p className="text-base leading-8 text-slate-700">{target.message}</p>
          {localError ? (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {localError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              تراجع
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setLocalError("");
                void target.run().catch((cause) => setLocalError(restaurantErrorMessage(cause)));
              }}
            >
              {busy ? "جارٍ التنفيذ…" : "نعم، نفّذ"}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
