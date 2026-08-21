import { useState } from "react";
import { Eye, Printer, Share2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { omanWhatsAppUrl } from "@/lib/phone";
import { printDocument } from "./printDocument";

/**
 * Consistent operational document bar: Preview / Print / Save PDF / Share / WhatsApp.
 * Never fakes delivery. WhatsApp is a prefilled chat — the user attaches the PDF.
 */
export function DocumentActions({
  previewOpen,
  onTogglePreview,
  phone,
  message,
  shareTitle,
}: {
  previewOpen?: boolean;
  onTogglePreview?: () => void;
  phone?: string | null;
  message: string;
  shareTitle: string;
}) {
  const [shareHint, setShareHint] = useState("");
  const whatsappUrl = omanWhatsAppUrl(phone);
  const whatsappWithText = whatsappUrl
    ? `${whatsappUrl}?text=${encodeURIComponent(message)}`
    : null;

  async function share() {
    setShareHint("");
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shareTitle, text: message });
        return;
      } catch {
        // User cancelled or share failed — fall through to the manual hint.
      }
    }
    setShareHint("المتصفح لا يشارك الملف مباشرة. اطبع أو احفظ PDF ثم أرفقه يدوياً في واتساب.");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {onTogglePreview && (
          <Button variant="outline" onClick={onTogglePreview}>
            <Eye className="h-5 w-5" />
            {previewOpen ? "إخفاء المعاينة" : "معاينة"}
          </Button>
        )}
        <Button variant="outline" onClick={() => printDocument()}>
          <Printer className="h-5 w-5" />
          طباعة / حفظ PDF
        </Button>
        <Button variant="outline" onClick={() => void share()}>
          <Share2 className="h-5 w-5" />
          مشاركة
        </Button>
        {whatsappWithText ? (
          <a
            href={whatsappWithText}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-5 text-sm font-bold text-emerald-800 hover:bg-emerald-50"
          >
            <MessageCircle className="h-5 w-5" />
            واتساب
          </a>
        ) : (
          <span className="inline-flex h-12 items-center rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-500">
            لا يوجد رقم واتساب صالح
          </span>
        )}
      </div>
      {shareHint && <p className="text-sm font-semibold text-slate-600">{shareHint}</p>}
      {whatsappWithText && (
        <p className="text-xs text-slate-500">
          واتساب يفتح المحادثة برسالة جاهزة. أرفق ملف PDF يدوياً إن لزم — لا يُرسل المستند تلقائياً.
        </p>
      )}
    </div>
  );
}
