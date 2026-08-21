import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { InlineError } from "@/components/ui/ErrorState";
import {
  evidenceError,
  useAttachEvidence,
  useEvidence,
  useEvidenceUrl,
  type EvidenceType,
} from "@/features/attachments/attachments.api";

type HandoverKind = "DELIVERY_PROOF" | "RETURN_PROOF" | "EQUIPMENT_DAMAGE";

const KINDS: { type: HandoverKind; label: string }[] = [
  { type: "DELIVERY_PROOF", label: "دليل التسليم" },
  { type: "RETURN_PROOF", label: "دليل الإرجاع" },
  { type: "EQUIPMENT_DAMAGE", label: "تلف / فقد" },
];

/**
 * Equipment handover evidence (delivery / return / damage photos) for one
 * reservation. Multiple photos are kept per kind; files live in the private
 * org-scoped bucket and are attached via the role-gated evidence command.
 */
export function HandoverEvidenceSection({
  orgId,
  reservationId,
  canEdit,
}: {
  orgId: string;
  reservationId: string;
  canEdit: boolean;
}) {
  return (
    <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-3">
      {KINDS.map((kind) => (
        <HandoverKindCell
          key={kind.type}
          orgId={orgId}
          reservationId={reservationId}
          kind={kind}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}

function HandoverKindCell({
  orgId,
  reservationId,
  kind,
  canEdit,
}: {
  orgId: string;
  reservationId: string;
  kind: { type: HandoverKind; label: string };
  canEdit: boolean;
}) {
  const evidence = useEvidence(orgId, kind.type as EvidenceType, "event_equipment_reservation", reservationId);
  const attach = useAttachEvidence();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const rows = evidence.data ?? [];

  async function onFile(file: File | null) {
    setError("");
    if (!file) return;
    try {
      await attach.mutateAsync({
        orgId,
        evidenceType: kind.type as EvidenceType,
        entityType: "event_equipment_reservation",
        entityId: reservationId,
        file,
        supersede: false,
      });
    } catch (cause) {
      setError(evidenceError(cause));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-bold text-slate-600">{kind.label}</p>
      <div className="flex flex-wrap items-center gap-2">
        {rows.map((row) => (
          <EvidenceThumb key={row.id} path={row.storagePath} fileName={row.fileName} label={kind.label} />
        ))}
        {rows.length === 0 && <span className="text-xs text-slate-400">لا يوجد</span>}
      </div>
      {canEdit && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={attach.isPending}
        >
          {attach.isPending ? "جارٍ الرفع…" : "إضافة صورة"}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
      />
      {error && <InlineError message={error} />}
    </div>
  );
}

function EvidenceThumb({ path, fileName, label }: { path: string; fileName: string; label: string }) {
  const url = useEvidenceUrl(path);
  if (!url.data) return null;
  return (
    <a href={url.data} target="_blank" rel="noreferrer" title={fileName}>
      <img src={url.data} alt={`${label} — ${fileName}`} className="h-12 w-12 rounded-md border border-slate-200 object-cover" />
    </a>
  );
}
