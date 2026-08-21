/**
 * Event command-center derivations: next action, attention items, equipment
 * lifecycle labels. Presentation only — never a new business rule.
 */

import type { EventStatus } from "./events.api";
import type { WorkspaceTab } from "./eventWorkspace.model";
import type { RosterCounts } from "@/features/staff/attendanceRoster.model";
import type { StaffingPlan } from "@/lib/staffing";

export interface CommandAction {
  id: string;
  label: string;
  tab?: WorkspaceTab;
  /** True when this is the single most relevant next step. */
  primary: boolean;
}

export interface AttentionItem {
  id: string;
  label: string;
  tab?: WorkspaceTab;
}

export function equipmentLifecycleLabel(input: {
  remainingToDispatch: number;
  dispatched: number;
  outstanding: number;
}): "مطلوب" | "جاهز" | "خرج" | "عاد" {
  if (input.outstanding > 0) return "خرج";
  if (input.dispatched > 0 && input.outstanding === 0) return "عاد";
  if (input.remainingToDispatch <= 0 && input.dispatched === 0) return "جاهز";
  return "مطلوب";
}

export const EQUIPMENT_RESERVATION_LABELS: Record<string, string> = {
  ACTIVE: "محجوز",
  RELEASED: "محرّر",
  CANCELLED: "ملغى",
};

export function buildNextActions(input: {
  status: EventStatus;
  assignedCount: number;
  roster: RosterCounts | null;
  outstandingMilli: number | null;
  warehouseOutstanding: number | null;
  financiallyClosed: boolean;
  canCommercial: boolean;
  canFinance: boolean;
  canAttendance: boolean;
  hasAcceptedQuote: boolean;
}): CommandAction[] {
  const actions: CommandAction[] = [];
  const push = (action: CommandAction) => actions.push(action);

  if (input.status === "DRAFT" || input.status === "QUOTED") {
    push({ id: "quote", label: "أكمل عرض السعر", tab: "التسعير", primary: true });
  }

  if (input.status === "CONFIRMED") {
    if (input.assignedCount === 0 && input.canAttendance) {
      push({ id: "assign", label: "أسند المضيفين", tab: "الفريق", primary: true });
      push({ id: "prepare", label: "بدء التجهيز", primary: false });
    } else {
      push({ id: "prepare", label: "بدء التجهيز", primary: true });
      if (input.canAttendance) {
        push({ id: "assign", label: "راجع الفريق", tab: "الفريق", primary: false });
      }
    }
  }

  if (input.status === "PREPARING") {
    const notArrived = input.roster?.notArrived;
    if (input.canAttendance && input.assignedCount > 0 && notArrived != null && notArrived > 0) {
      push({
        id: "checkin",
        label: "أكمل حضور الوصول",
        tab: "الحضور",
        primary: true,
      });
      push({ id: "dispatch", label: "تأكيد الإرسال", primary: false });
    } else {
      push({ id: "dispatch", label: "تأكيد الإرسال", primary: true });
      if (input.canAttendance) {
        push({ id: "attendance", label: "إثبات الحضور بالصورة", tab: "الحضور", primary: false });
      }
    }
    push({ id: "equipment", label: "جهّز المعدات", tab: "المعدات", primary: false });
  }

  if (input.status === "DISPATCHED") {
    push({ id: "start", label: "بدء التنفيذ", primary: true });
  }

  if (input.status === "IN_PROGRESS") {
    push({ id: "return", label: "بدء العودة والإرجاع", primary: true });
  }

  if (input.status === "RETURNING") {
    const present = input.roster?.present;
    const warehouseOut = input.warehouseOutstanding;
    if (input.canAttendance && present != null && present > 0) {
      push({
        id: "checkout",
        label: "أكمل تصوير الخروج",
        tab: "الحضور",
        primary: true,
      });
      push({ id: "close-ops", label: "إغلاق المناسبة", primary: false });
    } else if (warehouseOut != null && warehouseOut > 0) {
      push({
        id: "return-eq",
        label: "سجّل إرجاع المعدات",
        tab: "المخزن",
        primary: true,
      });
      push({ id: "close-ops", label: "إغلاق المناسبة", primary: false });
    } else {
      push({ id: "close-ops", label: "إغلاق المناسبة", primary: true });
    }
  }

  if (input.status === "CLOSED" && !input.financiallyClosed && input.canFinance) {
    if (input.outstandingMilli != null && input.outstandingMilli > 0) {
      push({ id: "pay", label: "تسجيل دفعة", tab: "المدفوعات", primary: true });
      push({ id: "close-fin", label: "إغلاق مالي", tab: "المالية", primary: false });
    } else {
      push({ id: "close-fin", label: "إغلاق مالي", tab: "المالية", primary: true });
    }
  }

  if (input.canFinance && input.status !== "CANCELLED" && input.status !== "DRAFT") {
    const hasPrimary = actions.some((a) => a.primary);
    if (!actions.some((a) => a.id === "pay")) {
      push({
        id: "pay-secondary",
        label: "تسجيل دفعة",
        tab: "المدفوعات",
        primary: !hasPrimary,
      });
    }
  }

  if (actions.length === 0 && input.canCommercial && input.status === "CANCELLED") {
    push({ id: "done", label: "المناسبة ملغاة", primary: true });
  }

  if (actions.length > 0 && !actions.some((a) => a.primary)) {
    const first = actions[0];
    if (first) actions[0] = { ...first, primary: true };
  }
  let seenPrimary = false;
  return actions.map((action) => {
    if (!action.primary) return action;
    if (seenPrimary) return { ...action, primary: false };
    seenPrimary = true;
    return action;
  });
}

export function buildAttentionItems(input: {
  status: EventStatus;
  roster: RosterCounts | null;
  staffing: StaffingPlan;
  outstandingMilli: number | null;
  warehouseOutstanding: number | null;
  warehouseDamaged: number | null;
  warehouseLost: number | null;
  readinessIncomplete: boolean;
  financiallyClosed: boolean;
  canFinance: boolean;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const execution = ["DISPATCHED", "IN_PROGRESS", "RETURNING", "CLOSED"].includes(
    input.status,
  );

  if (execution && input.roster && input.roster.notArrived > 0) {
    items.push({
      id: "hosts-missing",
      label: `${input.roster.notArrived} مضيف لم يصل`,
      tab: "الحضور",
    });
  }

  if (
    (input.status === "RETURNING" || input.status === "CLOSED") &&
    input.roster &&
    input.roster.present > 0
  ) {
    items.push({
      id: "still-in",
      label: `${input.roster.present} ما زال مفتوح الحضور`,
      tab: "الحضور",
    });
  }

  if (input.staffing.coverage === "BELOW" && input.staffing.shortfall != null) {
    items.push({
      id: "staffing-short",
      label:
        input.staffing.shortfall === 1
          ? "أقل من المقترح بمضيف"
          : "أقل من المقترح بمضيفين",
      tab: "الفريق",
    });
  }

  if (
    input.canFinance &&
    input.outstandingMilli != null &&
    input.outstandingMilli > 0 &&
    input.status !== "DRAFT" &&
    input.status !== "QUOTED"
  ) {
    items.push({
      id: "unpaid",
      label: "رصيد متبقٍ على العميل",
      tab: "المدفوعات",
    });
  }

  if (input.warehouseOutstanding != null && input.warehouseOutstanding > 0) {
    items.push({
      id: "eq-out",
      label: "معدات لم تعد",
      tab: "المخزن",
    });
  }

  if (
    (input.warehouseDamaged != null && input.warehouseDamaged > 0) ||
    (input.warehouseLost != null && input.warehouseLost > 0)
  ) {
    items.push({
      id: "eq-damage",
      label: "تلف أو فقد يحتاج متابعة",
      tab: "المخزن",
    });
  }

  if (input.readinessIncomplete && input.status === "PREPARING") {
    items.push({
      id: "readiness",
      label: "التجهيز غير مكتمل",
    });
  }

  if (
    input.status === "CLOSED" &&
    !input.financiallyClosed &&
    input.canFinance &&
    input.outstandingMilli === 0
  ) {
    items.push({
      id: "fin-close",
      label: "الإغلاق المالي معلّق",
      tab: "المالية",
    });
  }

  return items;
}
