import {
  MoneyError,
  multiplyOMR,
  parseOMR,
  parseQuantityMilli,
  toOMRString,
  type MilliOMR,
} from "@/lib/money";
import type {
  CreateProcurementOrderInput,
  ProcurementLineKind,
  ProcurementOrderLine,
  QuantityMilli,
  SupplierInput,
  SupplierKind,
} from "./contracts";

export interface SupplierFormDraft {
  name: string;
  kind: SupplierKind | "";
  phone: string;
  contactName: string;
  notes: string;
}

export type SupplierFormErrors = Partial<Record<keyof SupplierFormDraft, string>>;

export function validateSupplierDraft(draft: SupplierFormDraft): SupplierFormErrors {
  const errors: SupplierFormErrors = {};
  if (draft.name.trim().length < 2) errors.name = "اسم المورد مطلوب (حرفان على الأقل).";
  if (!draft.kind) errors.kind = "اختر نوع المورد.";
  const phone = draft.phone.replace(/[\s()+-]/g, "");
  if (phone && !/^\d{7,15}$/.test(phone)) {
    errors.phone = "أدخل رقم هاتف صحيحاً من 7 إلى 15 رقماً.";
  }
  return errors;
}

export function supplierDraftToInput(draft: SupplierFormDraft): SupplierInput {
  if (!draft.kind) throw new Error("Supplier kind must be validated first");
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    phone: draft.phone.trim() || null,
    contactName: draft.contactName.trim() || null,
    notes: draft.notes.trim() || null,
  };
}

export interface OrderLineDraft {
  key: number;
  description: string;
  kind: ProcurementLineKind;
  unit: string;
  quantityText: string;
  unitCostText: string;
}

export interface OrderFormDraft {
  supplierId: string;
  eventId: string;
  deliveryDueLocal: string;
  notes: string;
  lines: OrderLineDraft[];
}

export interface OrderFormErrors {
  supplierId?: string;
  deliveryDueLocal?: string;
  lines?: string;
  lineErrors: Record<number, {
    description?: string;
    unit?: string;
    quantity?: string;
    unitCost?: string;
  }>;
}

export type PositiveQuantityResult =
  | { ok: true; milli: QuantityMilli }
  | { ok: false; message: string };

export function parsePositiveQuantity(text: string): PositiveQuantityResult {
  if (!text.trim()) return { ok: false, message: "أدخل الكمية." };
  try {
    const milli = parseQuantityMilli(text);
    if (milli <= 0) return { ok: false, message: "الكمية يجب أن تكون أكبر من صفر." };
    return { ok: true, milli };
  } catch (error) {
    if (error instanceof MoneyError) {
      return {
        ok: false,
        message: "أدخل كمية صحيحة بثلاث خانات عشرية كحد أقصى.",
      };
    }
    throw error;
  }
}

export type OMRInputResult =
  | { ok: true; milli: MilliOMR | null }
  | { ok: false; message: string };

export function parseOptionalNonNegativeOMR(text: string): OMRInputResult {
  if (!text.trim()) return { ok: true, milli: null };
  try {
    const milli = parseOMR(text);
    if (milli < 0) return { ok: false, message: "المبلغ لا يمكن أن يكون سالباً." };
    return { ok: true, milli };
  } catch (error) {
    if (error instanceof MoneyError) {
      return { ok: false, message: "أدخل مبلغاً صحيحاً بدقة 3 خانات عشرية." };
    }
    throw error;
  }
}

function validLocalDateTime(value: string): boolean {
  if (!value.trim()) return false;
  return !Number.isNaN(new Date(value).getTime());
}

export function validateOrderDraft(draft: OrderFormDraft): OrderFormErrors {
  const errors: OrderFormErrors = { lineErrors: {} };
  if (!draft.supplierId) errors.supplierId = "اختر المورد.";
  if (!validLocalDateTime(draft.deliveryDueLocal)) {
    errors.deliveryDueLocal = "حدد تاريخ ووقت التوريد.";
  }
  if (draft.lines.length === 0) errors.lines = "أضف بنداً واحداً على الأقل.";

  for (const line of draft.lines) {
    const lineError: OrderFormErrors["lineErrors"][number] = {};
    if (!line.description.trim()) lineError.description = "وصف البند مطلوب.";
    if (!line.unit.trim()) lineError.unit = "الوحدة مطلوبة.";
    const quantity = parsePositiveQuantity(line.quantityText);
    if (!quantity.ok) lineError.quantity = quantity.message;
    const cost = parseOptionalNonNegativeOMR(line.unitCostText);
    if (!cost.ok) lineError.unitCost = cost.message;
    if (Object.keys(lineError).length > 0) errors.lineErrors[line.key] = lineError;
  }
  return errors;
}

export function hasOrderErrors(errors: OrderFormErrors): boolean {
  return Boolean(
    errors.supplierId ||
      errors.deliveryDueLocal ||
      errors.lines ||
      Object.keys(errors.lineErrors).length,
  );
}

export function orderDraftToInput(draft: OrderFormDraft): CreateProcurementOrderInput {
  return {
    supplierId: draft.supplierId,
    eventId: draft.eventId || null,
    deliveryDueAt: new Date(draft.deliveryDueLocal).toISOString(),
    notes: draft.notes.trim() || null,
    lines: draft.lines.map((line) => {
      const quantity = parsePositiveQuantity(line.quantityText);
      const cost = parseOptionalNonNegativeOMR(line.unitCostText);
      if (!quantity.ok || !cost.ok) throw new Error("Order draft must be validated first");
      return {
        description: line.description.trim(),
        kind: line.kind,
        unit: line.unit.trim(),
        quantityMilli: quantity.milli,
        unitCostMilli: cost.milli,
      };
    }),
  };
}

export interface ReceiptLineDraft {
  orderLineId: string;
  quantityText: string;
}

export type ReceiptErrors = Record<string, string>;

export function validateReceiptDraft(
  draft: ReceiptLineDraft[],
  orderLines: ProcurementOrderLine[],
): ReceiptErrors {
  const errors: ReceiptErrors = {};
  const byId = new Map(orderLines.map((line) => [line.id, line]));
  let hasQuantity = false;

  for (const item of draft) {
    if (!item.quantityText.trim()) continue;
    const line = byId.get(item.orderLineId);
    if (!line || !line.receive.allowed) {
      errors[item.orderLineId] = "هذا البند غير متاح للاستلام حالياً.";
      continue;
    }
    const quantity = parsePositiveQuantity(item.quantityText);
    if (!quantity.ok) {
      errors[item.orderLineId] = quantity.message;
      continue;
    }
    hasQuantity = true;
    if (quantity.milli > line.remainingQuantityMilli) {
      errors[item.orderLineId] = `الكمية أكبر من المتبقي (${formatQuantity(line.remainingQuantityMilli)}).`;
    }
  }

  if (!hasQuantity && Object.keys(errors).length === 0) {
    errors._form = "أدخل كمية لبند واحد على الأقل.";
  }
  return errors;
}

export function formatQuantity(milli: QuantityMilli): string {
  return toOMRString(milli).replace(/0+$/, "").replace(/\.$/, "");
}

/** Exact line preview; multiplication remains integer/BigInt via money.ts. */
export function linePreviewTotal(
  unitCostText: string,
  quantityText: string,
): MilliOMR | null {
  const cost = parseOptionalNonNegativeOMR(unitCostText);
  const quantity = parsePositiveQuantity(quantityText);
  if (!cost.ok || cost.milli === null || !quantity.ok) return null;
  try {
    return multiplyOMR(cost.milli, quantity.milli);
  } catch {
    return null;
  }
}
