import { useEffect, useId, useRef, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/domain";

/**
 * Active location (organization) switcher for multi-location operators.
 *
 * Renders NOTHING for a single-location user — the overwhelming majority — so
 * the header stays uncluttered; it appears only when the signed-in user really
 * holds more than one ACTIVE membership.
 *
 * The role shown next to each location is the role the user holds INSIDE that
 * organization, which is what makes switching meaningful (an OWNER in one
 * branch may be a SUPERVISOR in another). Authorization itself is unchanged
 * and remains enforced by RLS in the database.
 */
export function OrganizationSwitcher() {
  const { memberships, currentOrganization, switchOrganization } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  // Single-location operator: no switcher at all.
  if (memberships.length < 2) return null;

  const sorted = [...memberships].sort((a, b) =>
    a.organization.name.localeCompare(b.organization.name, "ar"),
  );

  return (
    <div ref={containerRef} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
      >
        <Building2 className="h-5 w-5 flex-none text-slate-400" />
        <span className="hidden max-w-[10rem] truncate sm:inline">
          {currentOrganization?.display_name ?? currentOrganization?.name ?? "اختر الموقع"}
        </span>
        <span className="sm:hidden">الموقع</span>
        <ChevronDown className="h-4 w-4 flex-none text-slate-400" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="اختيار الموقع"
          className="absolute inset-x-auto top-full z-50 mt-2 max-h-[60dvh] w-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl ltr:right-0 rtl:left-0"
        >
          <p className="px-2 pb-2 pt-1 text-xs font-bold text-slate-400">
            المواقع المتاحة
          </p>
          {sorted.map(({ membership, organization }) => {
            const active = organization.id === currentOrganization?.id;
            return (
              <button
                key={organization.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  switchOrganization(organization.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full min-h-12 items-center justify-between gap-2 rounded-xl px-3 py-2 text-right text-sm font-bold",
                  active
                    ? "bg-brand-50 text-brand-800"
                    : "text-slate-700 hover:bg-slate-100",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">
                    {organization.display_name ?? organization.name}
                  </span>
                  <span className="block text-xs font-semibold text-slate-500">
                    {ROLE_LABELS[membership.role] ?? membership.role}
                  </span>
                </span>
                {active && <Check className="h-4 w-4 flex-none text-brand-700" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
