import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { printDocument } from "@/components/documents/printDocument";

/**
 * Modal wrapper for an office document: the children render the
 * DocumentShell (which carries `data-document`, so the print stylesheet
 * isolates it on paper) and the footer offers the print action. Reused by
 * every printable surface so the print UX is one consistent pattern.
 */
export function PrintDocumentDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className="sm:max-w-3xl"
    >
      <div className="space-y-4">{children}</div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          إغلاق
        </Button>
        <Button onClick={() => printDocument()}>
          <Printer className="h-5 w-5" />
          طباعة / حفظ PDF
        </Button>
      </div>
    </Dialog>
  );
}
