/**
 * Quick event («مناسبة سريعة»): one form → issued quotation → accepted →
 * converted to a CONFIRMED event, using ONLY the existing server commands
 * (persist_quotation_draft → issue_quotation → accept_quotation →
 * convert_quotation_to_event). Nothing new on the database side.
 *
 * Also seeds the office's six printed offers as catalog items + packages so
 * the picked tier is a real package (audit trail + editable later).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { callRpc } from "@/lib/rpc";
import { toDbAmount, toDbNumeric, toOMRString } from "@/lib/money";
import { muscatWallClockToIso } from "@/lib/dates";
import type { CatalogItemType, PricingMethod } from "@/lib/dbTypes";
import type { QuotationRow } from "@/features/quotes/quotes.api";
import {
  OFFER_CATALOG_ITEMS,
  OFFER_FIXED_INCLUSIONS,
  OFFER_TERMS,
  OFFICE_OFFERS,
  type OfficeOffer,
} from "./officeOffers";

// ------------------------------------------------------------------ seeding

interface SeedItemSpec {
  name: string;
  itemType: CatalogItemType;
  unit: string;
  pricingMethod: PricingMethod;
}

const SEED_ITEMS: ReadonlyArray<SeedItemSpec> = [
  { name: OFFER_CATALOG_ITEMS.host, itemType: "STAFF", unit: "شخص", pricingMethod: "PER_EVENT" },
  { name: OFFER_CATALOG_ITEMS.supervisor, itemType: "STAFF", unit: "شخص", pricingMethod: "PER_EVENT" },
  { name: OFFER_CATALOG_ITEMS.coffeePot, itemType: "REUSABLE_EQUIPMENT", unit: "دلة", pricingMethod: "PER_UNIT" },
  { name: OFFER_CATALOG_ITEMS.lane, itemType: "SERVICE", unit: "مسار", pricingMethod: "PER_UNIT" },
  ...OFFER_FIXED_INCLUSIONS.map<SeedItemSpec>((name) => ({
    name,
    itemType: "CONSUMABLE",
    unit: "مجموعة",
    pricingMethod: "PER_EVENT",
  })),
  { name: OFFER_CATALOG_ITEMS.transport, itemType: "TRANSPORT", unit: "مناسبة", pricingMethod: "MANUAL" },
];

/** Package lines for a tier. The full tier price is carried by ONE line
 *  («سعر العرض») so the customer document shows the printed total exactly,
 *  while the staffing/equipment lines are quantity-only (price 0) so the
 *  team/warehouse tabs know what to prepare. */
function offerPackageName(o: OfficeOffer): string {
  return `${o.name} (${o.minGuests}–${o.maxGuests} شخص)`;
}

export function useOfferSeedStatus(orgId: string | null) {
  return useQuery({
    queryKey: ["office-offers-seeded", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return { seeded: false, packageIds: {} as Record<number, string> };
      const { data, error } = await supabase
        .from("packages")
        .select("id,name")
        .eq("organization_id", orgId)
        .eq("status", "ACTIVE");
      if (error) throw error;
      const packageIds: Record<number, string> = {};
      for (const o of OFFICE_OFFERS) {
        const hit = (data ?? []).find((p) => p.name === offerPackageName(o));
        if (hit) packageIds[o.tier] = hit.id;
      }
      return { seeded: Object.keys(packageIds).length === OFFICE_OFFERS.length, packageIds };
    },
  });
}

export function useSeedOfficeOffers(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("لا توجد منظمة محددة");

      // 1) catalog items (idempotent by name)
      const { data: existing, error: exErr } = await supabase
        .from("catalog_items")
        .select("id,name")
        .eq("organization_id", orgId);
      if (exErr) throw exErr;
      const byName = new Map((existing ?? []).map((r) => [r.name, r.id]));

      const missing = SEED_ITEMS.filter((s) => !byName.has(s.name));
      if (missing.length > 0) {
        const { data: inserted, error: insErr } = await supabase
          .from("catalog_items")
          .insert(
            missing.map((s) => ({
              organization_id: orgId,
              name: s.name,
              item_type: s.itemType,
              unit: s.unit,
              pricing_method: s.pricingMethod,
              cost_price: 0,
              selling_price: 0,
              status: "ACTIVE" as const,
            })),
          )
          .select("id,name");
        if (insErr) throw insErr;
        for (const r of inserted ?? []) byName.set(r.name, r.id);
      }

      // The priced line per tier: one catalog item per tier so the price is a
      // real selling_price on a real item (no "custom" lines).
      for (const o of OFFICE_OFFERS) {
        const name = `سعر ${o.name}`;
        if (!byName.has(name)) {
          const { data, error } = await supabase
            .from("catalog_items")
            .insert({
              organization_id: orgId,
              name,
              item_type: "SERVICE" as const,
              unit: "مناسبة",
              pricing_method: "PER_EVENT" as const,
              cost_price: 0,
              selling_price: toDbNumeric(o.priceMilli),
              description: `${o.minGuests}–${o.maxGuests} شخص · شامل كل مستلزمات الضيافة`,
              status: "ACTIVE" as const,
            })
            .select("id,name")
            .single();
          if (error) throw error;
          byName.set(name, data.id);
        }
      }

      // 2) packages (idempotent by name)
      const { data: pkgs, error: pkgErr } = await supabase
        .from("packages")
        .select("id,name")
        .eq("organization_id", orgId);
      if (pkgErr) throw pkgErr;
      const pkgByName = new Map((pkgs ?? []).map((p) => [p.name, p.id]));

      const id = (name: string) => {
        const v = byName.get(name);
        if (!v) throw new Error(`MISSING_CATALOG_ITEM:${name}`);
        return v;
      };
      const q = (n: number) => toDbAmount(n * 1000);

      for (const o of OFFICE_OFFERS) {
        const name = offerPackageName(o);
        if (pkgByName.has(name)) continue;
        await callRpc("save_package", {
          p_org_id: orgId,
          p_package_id: null,
          p_name: name,
          p_description: `${o.hosts} مضيف + ${o.supervisors} مشرف · ${o.coffeePots} دلة · ${o.lanes} مسار · ${toOMRString(o.priceMilli)} ر.ع`,
          p_status: "ACTIVE",
          p_base_guest_count: o.maxGuests,
          p_items: [
            { catalog_item_id: id(`سعر ${o.name}`), quantity: q(1) },
            { catalog_item_id: id(OFFER_CATALOG_ITEMS.host), quantity: q(o.hosts) },
            { catalog_item_id: id(OFFER_CATALOG_ITEMS.supervisor), quantity: q(o.supervisors) },
            { catalog_item_id: id(OFFER_CATALOG_ITEMS.coffeePot), quantity: q(o.coffeePots) },
            { catalog_item_id: id(OFFER_CATALOG_ITEMS.lane), quantity: q(o.lanes) },
            ...OFFER_FIXED_INCLUSIONS.map((n) => ({ catalog_item_id: id(n), quantity: q(1) })),
          ],
        });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["office-offers-seeded", orgId] });
      void qc.invalidateQueries({ queryKey: ["packages", orgId] });
      void qc.invalidateQueries({ queryKey: ["catalog-items", orgId] });
    },
  });
}

// ------------------------------------------------------------- quick event

export interface QuickEventInput {
  customerName: string;
  phone: string;
  /** Muscat wall-clock "YYYY-MM-DDTHH:mm". */
  startAt: string;
  /** Hours of service; end = start + hours. */
  durationHours: number;
  venue: string;
  guests: number;
  offer: OfficeOffer;
  outsideNizwa: boolean;
  notes: string;
}

export interface QuickEventResult {
  eventId: string;
  quotationId: string;
  quotationNumber: string | null;
}

function addHours(wallClock: string, hours: number): string {
  const d = new Date(wallClock);
  d.setHours(d.getHours() + hours);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function useCreateQuickEvent(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: QuickEventInput): Promise<QuickEventResult> => {
      if (!orgId) throw new Error("لا توجد منظمة محددة");
      const o = input.offer;
      const startIso = muscatWallClockToIso(input.startAt) ?? new Date(input.startAt).toISOString();
      const endWall = addHours(input.startAt, Math.max(1, input.durationHours));
      const endIso = muscatWallClockToIso(endWall) ?? new Date(endWall).toISOString();

      // Resolve catalog items by name (seeded above) to attach real sources.
      const { data: items, error: itemsErr } = await supabase
        .from("catalog_items")
        .select("id,name,item_type,unit,pricing_method")
        .eq("organization_id", orgId)
        .eq("status", "ACTIVE");
      if (itemsErr) throw itemsErr;
      const item = (name: string) => (items ?? []).find((r) => r.name === name) ?? null;

      const price = toOMRString(o.priceMilli);
      const line = (
        name: string,
        qty: number,
        unitPrice: string,
        fallback: { itemType: CatalogItemType; unit: string; pricingMethod: PricingMethod },
      ) => {
        const src = item(name);
        return {
          id: null,
          description: name,
          item_type: src?.item_type ?? fallback.itemType,
          unit: src?.unit ?? fallback.unit,
          pricing_method: src?.pricing_method ?? fallback.pricingMethod,
          quantity: toOMRString(qty * 1000),
          unit_selling_price: unitPrice,
          expected_unit_cost: "0.000",
          is_custom: src === null,
          source_catalog_item_id: src?.id ?? null,
          source_package_id: null,
          notes: null,
        };
      };

      const lines = [
        line(`سعر ${o.name}`, 1, price, { itemType: "SERVICE", unit: "مناسبة", pricingMethod: "PER_EVENT" }),
        line(OFFER_CATALOG_ITEMS.host, o.hosts, "0.000", { itemType: "STAFF", unit: "شخص", pricingMethod: "PER_EVENT" }),
        line(OFFER_CATALOG_ITEMS.supervisor, o.supervisors, "0.000", { itemType: "STAFF", unit: "شخص", pricingMethod: "PER_EVENT" }),
        line(OFFER_CATALOG_ITEMS.coffeePot, o.coffeePots, "0.000", { itemType: "REUSABLE_EQUIPMENT", unit: "دلة", pricingMethod: "PER_UNIT" }),
        line(OFFER_CATALOG_ITEMS.lane, o.lanes, "0.000", { itemType: "SERVICE", unit: "مسار", pricingMethod: "PER_UNIT" }),
        ...OFFER_FIXED_INCLUSIONS.map((n) =>
          line(n, 1, "0.000", { itemType: "CONSUMABLE", unit: "مجموعة", pricingMethod: "PER_EVENT" }),
        ),
      ];

      const notes = [
        `${o.name} — ${o.minGuests}–${o.maxGuests} شخص`,
        input.outsideNizwa ? "المناسبة خارج ولاية نزوى — تضاف رسوم نقل حسب الموقع." : null,
        input.notes.trim() || null,
      ]
        .filter(Boolean)
        .join("\n");

      // 1) draft
      const draft = await callRpc<QuotationRow>("persist_quotation_draft", {
        p_org_id: orgId,
        p_quotation_id: null,
        p_idempotency_key: crypto.randomUUID(),
        p_customer_id: null,
        p_prospect_name: input.customerName.trim(),
        p_prospect_phone: input.phone.trim() || null,
        p_prospect_whatsapp: input.phone.trim() || null,
        p_prospect_company: null,
        p_event_title: `ضيافة ${input.customerName.trim()}`,
        p_event_type: "OTHER",
        p_start_at: startIso,
        p_end_at: endIso,
        p_guest_count: input.guests,
        p_venue_name: input.venue.trim(),
        p_notes: notes || null,
        p_lines: lines,
      });

      // 1b) transport flag + terms (best effort; not fatal)
      try {
        await callRpc("set_quotation_pricing", {
          p_org_id: orgId,
          p_quotation_id: draft.id,
          p_idempotency_key: crypto.randomUUID(),
          p_transport_required: input.outsideNizwa,
          p_transport_zone: input.outsideNizwa ? "خارج ولاية نزوى" : null,
          p_transport_amount: null,
          p_transport_note: input.outsideNizwa ? "تحدد حسب الموقع والمسافة" : null,
          p_surcharge_amount: null,
          p_surcharge_note: null,
          p_discount_type: null,
          p_discount_value: null,
          p_valid_until: null,
        });
      } catch {
        /* pricing extras are optional for the quick path */
      }

      // 2) issue
      const issued = await callRpc<QuotationRow>("issue_quotation", {
        p_org_id: orgId,
        p_quotation_id: draft.id,
        p_terms: OFFER_TERMS.map((t) => `• ${t}`).join("\n"),
        p_idempotency_key: crypto.randomUUID(),
      });

      // 3) accept
      await callRpc<QuotationRow>("accept_quotation", {
        p_org_id: orgId,
        p_quotation_id: draft.id,
        p_idempotency_key: crypto.randomUUID(),
      });

      // 4) convert → CONFIRMED event (+ customer row if new)
      const converted = await callRpc<{ id: string }>("convert_quotation_to_event", {
        p_org_id: orgId,
        p_quotation_id: draft.id,
        p_idempotency_key: crypto.randomUUID(),
        p_start_at: startIso,
        p_end_at: endIso,
        p_venue_name: input.venue.trim(),
        p_guest_count: input.guests,
        p_event_title: `ضيافة ${input.customerName.trim()}`,
      });

      return {
        eventId: converted.id,
        quotationId: draft.id,
        quotationNumber: issued.quotation_number,
      };
    },
    onSuccess: () => {
      for (const key of ["events", "quotations", "customers", "operational-dashboard"]) {
        void qc.invalidateQueries({ queryKey: [key, orgId] });
      }
    },
  });
}
