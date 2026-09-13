import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarPlus, FileText, Plus, UserPlus } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { cn } from "@/lib/utils";

const QuickEventDialog = lazy(() =>
  import("@/features/quickEvent/QuickEventDialog").then((m) => ({
    default: m.QuickEventDialog,
  })),
);
const StaffMemberDialog = lazy(() =>
  import("@/features/staff/StaffMemberDialog").then((m) => ({
    default: m.StaffMemberDialog,
  })),
);

/**
 * «إضافة سريعة» in the app bar: the three things the office creates all day —
 * a quotation, an event booking, a host. Reuses the existing dialogs/pages;
 * nothing is re-implemented here.
 */
export function QuickAddMenu({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { currentOrganization, canManageCommercial, canIssueQuotation, canReadPayroll } =
    useAuth();
  const [open, setOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const canQuote = canManageCommercial || canIssueQuotation;

  const actions = [
    canQuote && {
      key: "quote",
      label: "عرض سعر جديد",
      icon: FileText,
      run: () => void navigate({ to: "/quotes/new" }),
    },
    {
      key: "event",
      label: "حجز مناسبة جديدة",
      icon: CalendarPlus,
      run: () => setEventOpen(true),
    },
    canReadPayroll && {
      key: "host",
      label: "مضيف جديد",
      icon: UserPlus,
      run: () => setHostOpen(true),
    },
  ].filter((a): a is Exclude<typeof a, false> => Boolean(a));

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="إضافة سريعة"
        title="إضافة سريعة"
        className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-3 text-sm font-bold text-white shadow-cta hover:bg-brand-800"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
        <span className="hidden sm:inline">إضافة</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="إضافة سريعة"
          className="absolute end-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
        >
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                action.run();
              }}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-bold text-slate-800 hover:bg-brand-50 hover:text-brand-900"
            >
              <action.icon className="h-[18px] w-[18px] text-brand-700" aria-hidden="true" />
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}

      <Suspense fallback={null}>
        {eventOpen && <QuickEventDialog open={eventOpen} onOpenChange={setEventOpen} />}
        {hostOpen && (
          <StaffMemberDialog
            open={hostOpen}
            onOpenChange={setHostOpen}
            orgId={currentOrganization?.id ?? null}
            member={null}
          />
        )}
      </Suspense>
    </div>
  );
}
