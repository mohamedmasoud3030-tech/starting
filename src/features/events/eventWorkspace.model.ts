import type { AppRole } from "@/lib/dbTypes";
import { COST_READER_ROLES, PAYMENT_WRITE_ROLES } from "@/lib/domain";

/**
 * Pure domain layer for the Event workspace: tab vocabulary, status/readiness
 * presentation, role-derived permissions and voice-summary selection.
 */

export const WORKSPACE_TABS = [
  "ملخص",
  "التسعير",
  "الفريق",
  "المعدات",
  "المخزن",
  "المواد",
  "المشتريات",
  "المدفوعات",
  "الفواتير",
  "الحضور",
  "الأجور",
  "السجل",
] as const;

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export const EVENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "مسودة",
  QUOTED: "تم التسعير",
  CONFIRMED: "مؤكدة",
  PREPARING: "قيد التجهيز",
  DISPATCHED: "تم الإرسال",
  IN_PROGRESS: "جارية",
  RETURNING: "قيد الإرجاع",
  CLOSED: "مغلقة",
  CANCELLED: "ملغاة",
};

export function readinessText(readiness: {
  status: string;
  staff_missing: number;
  equipment_shortage: number;
}): string {
  if (readiness.status === "READY") return "المناسبة جاهزة";
  if (readiness.status === "STAFF_MISSING")
    return `ناقص ${readiness.staff_missing} من الفريق`;
  if (readiness.status === "EQUIPMENT_SHORTAGE")
    return `ناقص ${readiness.equipment_shortage} من المعدات`;
  return `مشكلات متعددة: فريق ${readiness.staff_missing}، معدات ${readiness.equipment_shortage}`;
}

export interface EventPermissions {
  canCost: boolean;
  canCommercial: boolean;
  canFinance: boolean;
  canAttendance: boolean;
}

/** Role-derived capabilities INSIDE the current organization (UI affordances
 * only — the database remains authoritative via RLS/RPC checks). */
export function eventPermissions(role: AppRole | null): EventPermissions {
  return {
    canCost: !!role && COST_READER_ROLES.includes(role),
    canCommercial: role === "OWNER" || role === "MANAGER",
    canFinance: !!role && PAYMENT_WRITE_ROLES.includes(role),
    canAttendance:
      !!role && ["OWNER", "MANAGER", "SUPERVISOR"].includes(role),
  };
}

export interface VoiceSummaries {
  overview: string;
  pricing: string;
  payments: string;
  invoices: string;
  attendance: string;
  payroll: string;
}

/** The tab-specific voice summary used by the Owner Voice button. */
export function voiceSummaryForTab(
  tab: WorkspaceTab,
  summaries: VoiceSummaries,
): string {
  switch (tab) {
    case "التسعير":
      return summaries.pricing;
    case "المدفوعات":
      return summaries.payments;
    case "الفواتير":
      return summaries.invoices;
    case "الحضور":
      return summaries.attendance;
    case "الأجور":
      return summaries.payroll;
    default:
      return summaries.overview;
  }
}
