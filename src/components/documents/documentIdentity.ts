import type { OrganizationRow, OrganizationSettingsRow } from "@/lib/dbTypes";

/**
 * The unified document identity rendered on every official document.
 * Derived from the organization row + its settings; nothing is hard-coded.
 */
export interface DocumentIdentity {
  nameAr: string;
  nameEn: string | null;
  logoUrl: string | null;
  phonePrimary: string | null;
  phoneSecondary: string | null;
  whatsapp: string | null;
  email: string | null;
  commercialRegistration: string | null;
  postalCode: string | null;
  poBox: string | null;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  managerName: string | null;
  managerTitle: string | null;
  terms: string | null;
  footer: string | null;
}

/** Merge the tenant root and its settings into one render-ready identity. */
export function buildDocumentIdentity(
  org: OrganizationRow | null,
  settings: OrganizationSettingsRow | null,
): DocumentIdentity {
  return {
    nameAr: org?.name ?? "منشأة الضيافة",
    nameEn: settings?.name_en ?? org?.display_name ?? null,
    logoUrl: settings?.logo_url ?? null,
    phonePrimary: settings?.phone_primary ?? null,
    phoneSecondary: settings?.phone_secondary ?? null,
    whatsapp: settings?.whatsapp ?? null,
    email: settings?.email ?? null,
    commercialRegistration: settings?.commercial_registration ?? null,
    postalCode: settings?.postal_code ?? null,
    poBox: settings?.po_box ?? null,
    addressLine1: settings?.address_line1 ?? null,
    city: settings?.city ?? null,
    region: settings?.region ?? null,
    country: settings?.country ?? null,
    managerName: settings?.manager_name ?? null,
    managerTitle: settings?.manager_title ?? null,
    terms: settings?.document_terms ?? null,
    footer: settings?.document_footer ?? null,
  };
}
