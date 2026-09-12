import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_MIME_ALLOWED,
  attachmentStoragePath,
  type EvidenceType,
} from "@/features/attachments/attachments.api";

/**
 * Storage self-test probe helpers (pure — no Supabase client, fully unit-tested).
 *
 * Why these exist: the private `attachments` bucket only accepts writes at
 * `{org}/{evidence_type}/{entity}/{file}`, because migration 0074's
 * `attachments_insert_org_role` policy casts the SECOND path segment to the
 * `attachment_evidence_type` enum. A diagnostic probe written anywhere else is
 * rejected by the database even when storage is perfectly healthy, so the probe
 * must reuse the product's real path shape and a real evidence MIME type.
 */

/**
 * Evidence type used by the probe. EXPENSE_RECEIPT is the widest financial
 * evidence type: OWNER / MANAGER / ACCOUNTANT may write it
 * (`attachment_evidence_write_gate`, 0074). Deliberately NOT a facial-capture
 * or payroll type — those are restricted and would fail for most callers.
 */
export const HEALTH_PROBE_EVIDENCE_TYPE: EvidenceType = "EXPENSE_RECEIPT";

/** Entity segment (segment 3) — free-form, not policy-checked. */
export const HEALTH_PROBE_ENTITY = "health_check";

/** MIME of the probe object; must be one of the bucket's allowed types. */
export const HEALTH_PROBE_MIME = "image/jpeg";

/** The bucket the whole product stores evidence in. */
export const HEALTH_PROBE_BUCKET = ATTACHMENT_BUCKET;

/**
 * `{org}/{evidence_type}/{entity}/{file}` — the same shape as
 * `attachmentStoragePath()` in the attachments data layer, kept separate so the
 * diagnostic never writes inside a real record's folder (and is therefore
 * visible to the audited orphan/reclaim sweep rather than attached to anything).
 */
export function healthProbePath(orgId: string, fileName: string): string {
  return attachmentStoragePath(
    orgId,
    HEALTH_PROBE_EVIDENCE_TYPE,
    HEALTH_PROBE_ENTITY,
    fileName,
  );
}

/** A few bytes framed as a JPEG (SOI … EOI) — see `HEALTH_PROBE_MIME`. */
export function storageProbeBlob(): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
    type: HEALTH_PROBE_MIME,
  });
}

/** The probe MIME really is one the bucket's CHECK constraint accepts. */
export function healthProbeMimeIsAllowed(): boolean {
  return ATTACHMENT_MIME_ALLOWED.includes(HEALTH_PROBE_MIME);
}

export type StorageFailure = { status: "warn" | "error"; message: string };

/**
 * Translate a storage failure into an honest diagnosis.
 *
 * A role/RLS refusal is NOT "storage is broken": the bucket exists and answered.
 * Reporting it as an error sends a non-technical founder into the Supabase
 * dashboard to recreate a bucket that is already there, so refusals are a
 * warning with an actionable message (retry as the organization OWNER).
 */
export function classifyStorageFailure(cause: unknown): StorageFailure {
  const raw =
    cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const text = raw.toLowerCase();

  if (text.includes("bucket not found") || text.includes("bucket_not_found")) {
    return {
      status: "error",
      message: `Bucket "${HEALTH_PROBE_BUCKET}" غير موجود — أنشئه في Supabase Dashboard → Storage واجعله Private (الترحيل 0074 ينشئه تلقائياً عند تطبيق الترحيلات).`,
    };
  }

  if (
    text.includes("row-level security") ||
    text.includes("row level security") ||
    text.includes("permission denied") ||
    text.includes("42501") ||
    text.includes("violates row-level")
  ) {
    return {
      status: "warn",
      message:
        "التخزين يعمل ويستجيب، لكن دورك الحالي لا يملك صلاحية رفع هذا النوع من الأدلة (يتطلب OWNER أو MANAGER أو ACCOUNTANT). أعد الفحص بحساب المالك.",
    };
  }

  return {
    status: "error",
    message: `فشل اختبار الرفع: ${raw || "خطأ غير معروف"}`,
  };
}
