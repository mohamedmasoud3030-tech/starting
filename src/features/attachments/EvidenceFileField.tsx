import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { InlineError } from "@/components/ui/ErrorState";
import {
  evidenceError,
  useAttachEvidence,
  useEvidence,
  useEvidenceUrl,
  type EvidenceType,
} from "./attachments.api";

/**
 * Upload / view / replace a single private evidence file (ID card, contract,
 * receipt, delivery photo…). The file goes to the private bucket first, then
 * the server records it through the role-gated command; a failed upload is
 * surfaced explicitly and never presented as attached.
 */
export function EvidenceFileField({
  orgId,
  evidenceType,
  entityType,
  entityId,
  label,
  hint,
  accept = "image/jpeg,image/png,image/webp,application/pdf",
  capture,
  supersede = true,
  canEdit,
}: {
  orgId: string;
  evidenceType: EvidenceType;
  entityType: string;
  entityId: string;
  label: string;
  hint?: string;
  accept?: string;
  /** Rear camera on phones when the file is a photo. */
  capture?: boolean;
  supersede?: boolean;
  canEdit: boolean;
}) {
  const evidence = useEvidence(orgId, evidenceType, entityType, entityId);
  const attach = useAttachEvidence();
  const current = (evidence.data ?? [])[0];
  const url = useEvidenceUrl(current?.storagePath ?? null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  async function onFile(file: File | null) {
    setError("");
    if (!file) return;
    try {
      await attach.mutateAsync({
        orgId,
        evidenceType,
        entityType,
        entityId,
        file,
        supersede,
      });
    } catch (cause) {
      setError(evidenceError(cause));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1">
      <p className="font-semibold text-slate-700">{label}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}

      {evidence.isLoading ? (
        <p className="text-sm text-slate-400">جارٍ التحميل…</p>
      ) : current && url.data ? (
        <div className="flex flex-wrap items-center gap-3">
          {current.mimeType.startsWith("image/") ? (
            <img
              src={url.data}
              alt={label}
              className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
            />
          ) : (
            <a
              href={url.data}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-brand-700"
            >
              فتح الملف (PDF)
            </a>
          )}
          <div className="text-xs text-slate-500">
            <p dir="ltr">{current.fileName}</p>
            <p>
              {new Date(current.createdAt).toLocaleString("ar-OM", { timeZone: "Asia/Muscat" })}
            </p>
          </div>
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={attach.isPending}
            >
              {attach.isPending ? "جارٍ الرفع…" : "استبدال"}
            </Button>
          )}
        </div>
      ) : (
        canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={attach.isPending}
          >
            {attach.isPending ? "جارٍ الرفع…" : "رفع"}
          </Button>
        )
      )}

      {canEdit && (
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          capture={capture ? "environment" : undefined}
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
      )}
      {error && <InlineError message={error} />}
    </div>
  );
}
