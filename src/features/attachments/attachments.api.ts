import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { callRpc } from "@/lib/rpc";

/**
 * Centralized private-evidence data layer (migration 0074).
 *
 * Uploads go to the PRIVATE `attachments` storage bucket under an
 * organization-scoped path; the server then records metadata (or links the
 * evidence to its target record) through the role-gated SECURITY DEFINER
 * commands. Reads use signed URLs — never public URLs.
 */

export const ATTACHMENT_BUCKET = "attachments";
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export const ATTACHMENT_MIME_ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type EvidenceType =
  | "STAFF_ID"
  | "STAFF_CONTRACT"
  | "ATTENDANCE_CHECKIN"
  | "ATTENDANCE_CHECKOUT"
  | "HOST_PAYOUT_RECEIPT"
  | "EXPENSE_RECEIPT"
  | "DELIVERY_PROOF"
  | "RETURN_PROOF"
  | "EQUIPMENT_DAMAGE";

export interface EvidenceRow {
  id: string;
  organizationId: string;
  evidenceType: EvidenceType;
  entityType: string;
  entityId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  metadata: Record<string, unknown> | null;
  supersededAt: string | null;
  createdAt: string;
}

export interface UploadedEvidence {
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export function attachmentStoragePath(
  orgId: string,
  evidenceType: EvidenceType,
  entityType: string,
  fileName: string,
): string {
  return `${orgId}/${evidenceType}/${entityType}/${fileName}`;
}

/** Validate a file before upload; returns a localized error or null. */
export function attachmentFileError(file: File): string | null {
  if (file.size <= 0) return "الملف فارغ";
  if (file.size > ATTACHMENT_MAX_BYTES) return "حجم الملف يتجاوز الحد الأقصى (5 ميغابايت)";
  if (!(ATTACHMENT_MIME_ALLOWED as readonly string[]).includes(file.type)) {
    return "نوع الملف غير مدعوم — صور JPEG/PNG/WebP أو PDF فقط";
  }
  return null;
}

/** Upload a file to the private bucket; returns the exact path + metadata. */
export async function uploadEvidenceFile(
  orgId: string,
  evidenceType: EvidenceType,
  entityType: string,
  file: File,
): Promise<UploadedEvidence> {
  const err = attachmentFileError(file);
  if (err) throw new Error(err);
  const ext = file.name.includes(".")
    ? file.name.split(".").pop()?.toLowerCase()
    : file.type === "application/pdf"
      ? "pdf"
      : "jpg";
  const fileName = `${crypto.randomUUID()}.${ext ?? "jpg"}`;
  const storagePath = attachmentStoragePath(orgId, evidenceType, entityType, fileName);
  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(storagePath, file, { upsert: false });
  if (error) throw error;
  return {
    storagePath,
    fileName,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}

function mapEvidence(row: Record<string, unknown>): EvidenceRow {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    evidenceType: row.evidence_type as EvidenceType,
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    storagePath: String(row.storage_path),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    supersededAt: (row.superseded_at as string) ?? null,
    createdAt: String(row.created_at),
  };
}

/** Current (non-superseded) evidence for a target record. */
export function useEvidence(
  orgId: string | null,
  evidenceType: EvidenceType | null,
  entityType: string | null,
  entityId: string | null,
) {
  return useQuery({
    queryKey: ["evidence", orgId, evidenceType, entityType, entityId],
    enabled: !!orgId && !!evidenceType && !!entityType && !!entityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attachment_evidence")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("evidence_type", evidenceType!)
        .eq("entity_type", entityType!)
        .eq("entity_id", entityId!)
        .is("superseded_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => mapEvidence(row as Record<string, unknown>));
    },
  });
}

/** A short-lived signed URL for an uploaded object (never a public URL). */
export function useEvidenceUrl(storagePath: string | null) {
  return useQuery({
    queryKey: ["evidence-url", storagePath],
    enabled: !!storagePath,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(storagePath!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export interface AttachEvidenceInput {
  orgId: string;
  evidenceType: EvidenceType;
  entityType: string;
  entityId: string;
  file: File;
  supersede?: boolean;
  metadata?: Record<string, unknown> | null;
}

/** Convert a canvas/`data:` URL into a File for the evidence upload. */
export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const comma = dataUrl.indexOf(",");
  const head = comma >= 0 ? dataUrl.slice(0, comma) : "";
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : "";
  const mime = /data:(.*?);/.exec(head)?.[1] ?? "image/png";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], fileName, { type: mime });
}

/** Upload + record evidence for an existing record, in the right order. */
export function useAttachEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: AttachEvidenceInput): Promise<EvidenceRow> => {
      const uploaded = await uploadEvidenceFile(
        v.orgId,
        v.evidenceType,
        v.entityType,
        v.file,
      );
      const row = await callRpc<Record<string, unknown>>("attach_evidence", {
        p_org_id: v.orgId,
        p_evidence_type: v.evidenceType,
        p_entity_type: v.entityType,
        p_entity_id: v.entityId,
        p_storage_path: uploaded.storagePath,
        p_file_name: uploaded.fileName,
        p_mime_type: uploaded.mimeType,
        p_size_bytes: uploaded.sizeBytes,
        p_supersede: v.supersede ?? false,
        p_idempotency_key: crypto.randomUUID(),
        p_metadata: v.metadata ?? null,
      });
      return mapEvidence(row);
    },
    onSuccess: (_row, v) => {
      void qc.invalidateQueries({
        queryKey: ["evidence", v.orgId, v.evidenceType, v.entityType, v.entityId],
      });
    },
  });
}

/** Arabic, owner-friendly error messages for the evidence surface. */
export function evidenceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("NOT_AUTHORIZED")) return "ليس لديك صلاحية لهذا النوع من المرفقات";
  if (message.includes("ATTACHMENT_SIZE_EXCEEDED")) return "حجم الملف يتجاوز الحد الأقصى";
  if (message.includes("ATTACHMENT_MIME_NOT_ALLOWED")) return "نوع الملف غير مدعوم";
  if (message.includes("ATTACHMENT_OBJECT_MISSING")) return "لم يُحفظ الملف — أعد الرفع";
  if (message.includes("ATTACHMENT_PATH_INVALID")) return "مسار الملف غير صالح";
  if (message.includes("EVIDENCE_TARGET_NOT_IN_ORG")) return "السجل لا يتبع منظمتك";
  if (message.includes("SELFIE_REQUIRED")) return "صورة الحضور مطلوبة";
  return message;
}
