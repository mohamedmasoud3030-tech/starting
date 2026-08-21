import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { InlineError } from "@/components/ui/ErrorState";
import {
  dataUrlToFile,
  evidenceError,
  useAttachEvidence,
} from "@/features/attachments/attachments.api";

/**
 * Simple customer proof-of-delivery signature. Touch/mouse strokes on a canvas
 * are saved as private delivery evidence attached to the event (with the
 * customer name and a server timestamp). This is a practical handover proof —
 * not an e-signature platform and not a customer portal.
 */
export function DeliverySignature({
  orgId,
  eventId,
  canEdit,
}: {
  orgId: string;
  eventId: string;
  canEdit: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [customerName, setCustomerName] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const attach = useAttachEvidence();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  function pos(e: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function begin(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    const { x, y } = pos(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const { x, y } = pos(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSaved(false);
    setError("");
  }

  async function save() {
    setError("");
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    try {
      const file = dataUrlToFile(dataUrl, "delivery-signature.png");
      await attach.mutateAsync({
        orgId,
        evidenceType: "DELIVERY_PROOF",
        entityType: "event",
        entityId: eventId,
        file,
        supersede: false,
        metadata: {
          kind: "delivery_signature",
          customer_name: customerName.trim() || null,
        },
      });
      setSaved(true);
    } catch (cause) {
      setError(evidenceError(cause));
    }
  }

  if (!canEdit) return null;

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-slate-200 p-3">
      <p className="font-black">توقيع استلام العميل</p>
      <p className="text-xs text-slate-500">
        توقيع بسيط باللمس/الماوس كإثبات تسليم — لا منصة توقيع إلكتروني.
      </p>
      <Field label="اسم العميل (اختياري)" htmlFor="sig-name">
        <Input
          id="sig-name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
        />
      </Field>
      <canvas
        ref={canvasRef}
        width={600}
        height={180}
        className="w-full touch-none rounded-lg border border-slate-300 bg-white"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void save()} disabled={attach.isPending}>
          {attach.isPending ? "جارٍ الحفظ…" : saved ? "حُفظ التوقيع" : "حفظ كإثبات تسليم"}
        </Button>
        <Button size="sm" variant="ghost" onClick={clear} disabled={attach.isPending}>
          مسح
        </Button>
      </div>
      {error && <InlineError message={error} />}
    </div>
  );
}
