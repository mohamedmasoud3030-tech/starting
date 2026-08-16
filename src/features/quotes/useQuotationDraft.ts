import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/app/authContext";
import { usePackages } from "@/features/packages/packages.api";
import { useCatalogItems } from "@/features/catalog/catalog.api";
import { parseOMR, parseQuantityMilli, type MilliOMR } from "@/lib/money";
import {
  arabicQuotationError,
  useCancelQuotationDraft,
  useIssueQuotation,
  usePersistQuotationDraft,
  useQuotation,
  useQuotationLines,
} from "./quotes.api";
import { computeQuotationLineTotalMilli, sumQuotationLineTotals } from "./quotationMath";
import {
  buildPackageLines,
  createCustomLine,
  createLineKeyFactory,
  draftFingerprint,
  emptyForm,
  guestCountFromDraft,
  hydrateFormFromDraft,
  hydrateLinesFromServer,
  toDraftValues,
  toServerLinePayload,
  type DraftForm,
  type DraftLine,
} from "./quotationDraft.model";

export type DraftBusy = "" | "الحفظ" | "الإصدار" | "حذف";

/**
 * Controller for the quotation draft editor: local workflow state, server
 * mutation coordination (atomic draft persistence with stable idempotency
 * keys), navigation decisions, and the derived line math. The editor
 * component and its steps are pure presentation over this hook.
 */
export function useQuotationDraft(draftId?: string) {
  const auth = useAuth();
  const { canManageCommercial } = auth;
  const orgId = auth.currentOrganization?.id ?? null;
  const navigate = useNavigate();

  const existing = useQuotation(orgId, draftId ?? "");
  const existingLines = useQuotationLines(orgId, draftId ?? "");
  const packages = usePackages(orgId);
  const catalog = useCatalogItems(orgId, true);

  const persistDraftMutation = usePersistQuotationDraft(orgId);
  const issue = useIssueQuotation(orgId);
  const discard = useCancelQuotationDraft(orgId);

  const [form, setForm] = useState<DraftForm>(emptyForm);
  const [guestCount, setGuestCount] = useState("");
  const [savedDraftId, setSavedDraftId] = useState<string | null>(draftId ?? null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<DraftBusy>("");
  const [issueConfirmationOpen, setIssueConfirmationOpen] = useState(false);
  const saveIntentRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const nextLineKeyRef = useRef(createLineKeyFactory());

  // Edit mode: hydrate form + guest count from the persisted draft.
  useEffect(() => {
    if (draftId && existing.data) {
      setForm(hydrateFormFromDraft(existing.data));
      setGuestCount(guestCountFromDraft(existing.data));
    }
  }, [draftId, existing.data]);

  // Edit mode: hydrate lines from the persisted draft.
  useEffect(() => {
    if (draftId && existingLines.data) {
      setLines(hydrateLinesFromServer(existingLines.data));
    }
  }, [draftId, existingLines.data]);

  const guestCountNum = guestCount.trim() === "" ? null : Number(guestCount);

  const lineTotals = useMemo<Array<MilliOMR | null>>(
    () =>
      lines.map((line) => {
        try {
          return computeQuotationLineTotalMilli(
            line.pricingMethod,
            parseOMR(line.unitSellingPrice),
            parseQuantityMilli(line.quantity),
            guestCountNum,
          );
        } catch {
          return null;
        }
      }),
    [lines, guestCountNum],
  );
  const grandTotalMilli = useMemo(() => sumQuotationLineTotals(lineTotals), [lineTotals]);
  const pricingBlocked = useMemo(
    () => lineTotals.some((total) => total === null),
    [lineTotals],
  );

  function setField<K extends keyof DraftForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /**
   * Atomic draft persistence. The idempotency key is derived from the payload
   * fingerprint: an unchanged retry after a lost response reuses the exact
   * same key (so the server command is idempotent), while any payload change
   * or confirmed response rotates it.
   */
  async function persistDraft(): Promise<string> {
    const values = toDraftValues(form, guestCountNum);
    const fingerprint = draftFingerprint({
      quotationId: savedDraftId,
      values,
      lines,
    });
    if (!saveIntentRef.current || saveIntentRef.current.fingerprint !== fingerprint) {
      saveIntentRef.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
    }

    const quote = await persistDraftMutation.mutateAsync({
      quotationId: savedDraftId,
      idempotencyKey: saveIntentRef.current.idempotencyKey,
      values,
      lines: lines.map(toServerLinePayload),
    });
    setSavedDraftId(quote.id);
    saveIntentRef.current = null;
    return quote.id;
  }

  function addCustomLine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const description = String(f.get("description") ?? "").trim();
    const quantity = String(f.get("quantity") ?? "");
    const price = String(f.get("price") ?? "");
    if (!description || !quantity || !price) {
      setError("أكمل وصف الخدمة والكمية والسعر");
      return;
    }
    const line = createCustomLine(nextLineKeyRef.current(), {
      description,
      quantity,
      price,
      itemType: String(f.get("itemType")),
      unit: String(f.get("unit") ?? "وحدة"),
      pricingMethod: String(f.get("pricingMethod")),
    });
    setLines((ls) => [...ls, line]);
    e.currentTarget.reset();
  }

  function applySelectedPackage() {
    setError("");
    if (!selectedPackage) {
      setError("اختر الباقة أولاً");
      return;
    }
    const pkg = packages.data?.find((p) => p.package.id === selectedPackage);
    if (!pkg || pkg.lines.length === 0) {
      setError("الباقة لا تحتوي على خدمات");
      return;
    }
    const catalogById = new Map(catalog.data?.map((c) => [c.id, c]) ?? []);
    const missing = pkg.lines.some((l) => !catalogById.has(l.catalog_item_id));
    if (missing) {
      setError("تعذر تحميل تفاصيل بعض خدمات الباقة");
      return;
    }
    try {
      const added = buildPackageLines(pkg, catalogById, selectedPackage, nextLineKeyRef.current);
      setLines((ls) => [...ls, ...added]);
      setSelectedPackage("");
    } catch {
      setError("تعذر تحميل تفاصيل بعض خدمات الباقة");
    }
  }

  function updateLine(
    clientKey: string,
    patch: Partial<Pick<DraftLine, "description" | "quantity" | "unitSellingPrice">>,
  ) {
    setLines((current) =>
      current.map((line) => (line.clientKey === clientKey ? { ...line, ...patch } : line)),
    );
  }

  function removeLine(clientKey: string) {
    setLines((ls) => ls.filter((l) => l.clientKey !== clientKey));
  }

  async function onDiscard() {
    setError("");
    if (!savedDraftId) return;
    setBusy("حذف");
    try {
      await discard.mutateAsync(savedDraftId);
      await navigate({ to: "/quotes" });
    } catch (x) {
      setError(arabicQuotationError(x));
      setBusy("");
    }
  }

  async function onSaveDraft() {
    setError("");
    setBusy("الحفظ");
    try {
      const id = await persistDraft();
      if (!draftId) await navigate({ to: "/quotes/$quoteId", params: { quoteId: id } });
      setBusy("");
    } catch (cause) {
      setError(arabicQuotationError(cause));
      setBusy("");
    }
  }

  async function onIssue() {
    setIssueConfirmationOpen(false);
    setError("");
    if (lines.length === 0) {
      setError("أضف خدمة واحدة على الأقل قبل الإصدار");
      return;
    }
    setBusy("الإصدار");
    try {
      const id = await persistDraft();
      await issue.mutateAsync(id);
      await navigate({ to: "/quotes/$quoteId", params: { quoteId: id } });
    } catch (x) {
      setError(arabicQuotationError(x));
      setBusy("");
    }
  }

  return {
    // context
    orgId,
    canManageCommercial,
    editMode: Boolean(draftId),
    // data
    existing,
    existingLines,
    packages,
    catalog,
    // editable state
    form,
    setField,
    guestCount,
    setGuestCount,
    guestCountNum,
    lines,
    selectedPackage,
    setSelectedPackage,
    savedDraftId,
    error,
    busy,
    issueConfirmationOpen,
    setIssueConfirmationOpen,
    // derived
    lineTotals,
    grandTotalMilli,
    pricingBlocked,
    // actions
    addCustomLine,
    applySelectedPackage,
    updateLine,
    removeLine,
    onSaveDraft,
    onIssue,
    onDiscard,
  };
}
