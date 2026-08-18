import type { ReactNode } from "react";
import type { DocumentIdentity } from "./documentIdentity";

/**
 * Reusable official-document shell: letterhead, title, meta line, body,
 * signature and footer. Used by quotations, invoices and receipts so every
 * customer-facing document carries the same professional identity.
 *
 * The rendered element carries `data-document` so the print stylesheet can
 * isolate it on paper (see index.css `@media print`).
 */
export function DocumentShell({
  identity,
  title,
  documentNumber,
  dateText,
  meta,
  children,
  signature = true,
}: {
  identity: DocumentIdentity;
  title: string;
  documentNumber?: string | null;
  dateText?: string | null;
  meta?: ReactNode;
  children: ReactNode;
  signature?: boolean;
}) {
  return (
    <div data-document className="rounded-2xl border-2 border-brand-700 bg-white p-6 text-slate-900 sm:p-8">
      {/* Letterhead */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-brand-700 pb-4">
        <div className="flex items-center gap-3">
          {identity.logoUrl && (
            <img
              src={identity.logoUrl}
              alt=""
              className="h-14 w-14 rounded-xl object-contain"
            />
          )}
          <div>
            <p className="text-2xl font-black leading-tight">{identity.nameAr}</p>
            {identity.nameEn && (
              <p dir="ltr" className="text-base font-bold text-slate-500">
                {identity.nameEn}
              </p>
            )}
          </div>
        </div>
        <div className="text-sm leading-6 text-slate-600">
          {identity.phonePrimary && (
            <p>
              <span className="font-bold text-slate-500">جوال: </span>
              <span dir="ltr">{identity.phonePrimary}</span>
            </p>
          )}
          {identity.phoneSecondary && (
            <p>
              <span className="font-bold text-slate-500">جوال: </span>
              <span dir="ltr">{identity.phoneSecondary}</span>
            </p>
          )}
          {identity.email && (
            <p>
              <span dir="ltr">{identity.email}</span>
            </p>
          )}
        </div>
      </header>

      {/* Address / legal line */}
      {(identity.commercialRegistration ||
        identity.postalCode ||
        identity.poBox ||
        identity.addressLine1 ||
        identity.city ||
        identity.country) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-200 py-3 text-sm text-slate-600">
          {identity.commercialRegistration && (
            <span>
              السجل التجاري: <span dir="ltr">{identity.commercialRegistration}</span>
            </span>
          )}
          {identity.postalCode && (
            <span>
              الرمز البريدي: <span dir="ltr">{identity.postalCode}</span>
            </span>
          )}
          {identity.poBox && (
            <span>
              ص.ب: <span dir="ltr">{identity.poBox}</span>
            </span>
          )}
          {[identity.addressLine1, identity.city, identity.region, identity.country]
            .filter(Boolean)
            .length > 0 && (
            <span>
              {[identity.addressLine1, identity.city, identity.region, identity.country]
                .filter(Boolean)
                .join("، ")}
            </span>
          )}
        </div>
      )}

      {/* Title + document meta */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black">{title}</h2>
        <div className="text-sm text-slate-600">
          {documentNumber && (
            <p>
              رقم المستند: <span dir="ltr" className="font-bold">{documentNumber}</span>
            </p>
          )}
          {dateText && (
            <p>
              التاريخ: <span className="font-bold">{dateText}</span>
            </p>
          )}
        </div>
      </div>

      {meta && <div className="mt-3">{meta}</div>}

      {/* Body */}
      <div className="mt-4">{children}</div>

      {/* Terms */}
      {identity.terms && (
        <div className="mt-6 border-t border-slate-200 pt-3">
          <p className="text-sm font-black text-slate-600">الشروط:</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">
            {identity.terms}
          </p>
        </div>
      )}

      {/* Signature block */}
      {signature && identity.managerName && (
        <div className="mt-10 flex justify-start">
          <div className="text-center">
            <div className="h-14 w-44 border-b border-slate-400" />
            <p className="mt-1 text-sm font-bold">{identity.managerName}</p>
            {identity.managerTitle && (
              <p className="text-sm text-slate-500">{identity.managerTitle}</p>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      {identity.footer && (
        <p className="mt-6 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
          {identity.footer}
        </p>
      )}
    </div>
  );
}
