import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageOpen } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { callRpc } from "@/lib/rpc";
import { useAuth } from "@/app/authContext";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { InlineError } from "@/components/ui/ErrorState";
import { useCatalogItems } from "@/features/catalog/catalog.api";
import { useSaveEquipmentCapacity } from "./warehouse.api";

/**
 * Organisation-level view of the reusable kit (العدة): how many of each item
 * the office owns, how many are reserved for events in the next 7 days, and
 * how many are free. Reads the same `equipment_capacity` rows the event
 * workspace reserves against and the server's `equipment_availability` RPC —
 * nothing is recomputed on the client.
 */

interface CapacityRow {
  id: string;
  catalog_item_id: string;
  total_quantity: number;
  catalog_items: { name: string } | null;
}

interface Availability {
  total: number;
  reserved: number;
  available: number;
  shortage: number;
}

function useKitStock(orgId: string | null) {
  return useQuery({
    queryKey: ["kit-stock", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment_capacity")
        .select("id, catalog_item_id, total_quantity, catalog_items(name)")
        .eq("organization_id", orgId!)
        .eq("is_active", true)
        .order("total_quantity", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as CapacityRow[];
      const from = new Date();
      const until = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
      const avail = await Promise.all(
        rows.map((r) =>
          callRpc<Availability[]>("equipment_availability", {
            p_org_id: orgId!,
            p_capacity_id: r.id,
            p_from: from.toISOString(),
            p_until: until.toISOString(),
            p_requested: 0,
          }).then((a) => a?.[0] ?? null).catch(() => null),
        ),
      );
      return rows.map((r, i) => ({ ...r, availability: avail[i] }));
    },
  });
}

export function KitStockPanel({ canManage }: { canManage: boolean }) {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id ?? null;
  const stock = useKitStock(orgId);
  const catalog = useCatalogItems(orgId);
  const save = useSaveEquipmentCapacity(orgId);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const rows = stock.data ?? [];
  const reusable = (catalog.data?.rows ?? []).filter(
    (c) => c.item_type === "REUSABLE_EQUIPMENT" && c.status === "ACTIVE",
  );

  async function submit() {
    const n = Number(qty);
    if (!itemId || !Number.isFinite(n) || n < 0) {
      setMsg({ tone: "err", text: "اختر الصنف واكتب عدداً صحيحاً." });
      return;
    }
    const existing = rows.find((r) => r.catalog_item_id === itemId);
    try {
      await save.mutateAsync({ values: { catalogItemId: itemId, totalQuantity: n }, existingId: existing?.id ?? null });
      setMsg({ tone: "ok", text: "تم حفظ الكمية." });
      setItemId("");
      setQty("");
      void stock.refetch();
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "تعذّر الحفظ." });
    }
  }

  if (stock.isLoading) return <LoadingState label="جارٍ تحميل العدة…" />;
  if (stock.isError) return <InlineError message="تعذّر تحميل العدة. أعد المحاولة." />;

  return (
    <div className="space-y-4">
      {canManage && (
        <Card className="p-4">
          <h2 className="font-black">كام قطعة عندكم من كل صنف؟</h2>
          <p className="mt-1 text-sm text-slate-500">
            اكتب العدد الكلي المملوك (دلال، فناجين، ترامس…) — الحجز في المناسبات بيتحسب عليه.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="الصنف" className="min-w-56 flex-1">
              <option value="">اختر الصنف</option>
              {reusable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              min="0"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="العدد الكلي"
              aria-label="العدد الكلي"
              className="w-32"
            />
            <Button type="button" onClick={() => void submit()} disabled={save.isPending}>
              حفظ
            </Button>
          </div>
          {msg && (
            <p
              className={msg.tone === "ok" ? "mt-2 text-sm font-bold text-emerald-700" : "mt-2 text-sm font-bold text-red-700"}
              role={msg.tone === "ok" ? "status" : "alert"}
            >
              {msg.text}
            </p>
          )}
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="لم تُسجَّل عدة بعد"
          description="سجّل كميات العدة المملوكة عشان تقدر تحجزها للمناسبات وتتابع إرجاعها."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const a = r.availability;
            const reserved = a?.reserved ?? 0;
            const available = a?.available ?? r.total_quantity;
            const tight = a ? a.available <= 0 : false;
            return (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-black text-slate-900">{r.catalog_items?.name ?? "صنف"}</p>
                    <p className="mt-0.5 text-sm text-slate-500">العدد الكلي {r.total_quantity}</p>
                  </div>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <PackageOpen className="h-5 w-5" aria-hidden="true" />
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-slate-50 p-2">
                    <p className="text-xs font-bold text-slate-500">محجوز (7 أيام)</p>
                    <p className="text-xl font-black text-slate-900">{reserved}</p>
                  </div>
                  <div className={tight ? "rounded-xl bg-red-50 p-2" : "rounded-xl bg-emerald-50 p-2"}>
                    <p className="text-xs font-bold text-slate-500">متاح</p>
                    <p className={tight ? "text-xl font-black text-red-700" : "text-xl font-black text-emerald-700"}>
                      {available}
                    </p>
                  </div>
                </div>
                {tight && <Badge tone="danger" className="mt-2">لا يوجد متاح — راجع الحجوزات</Badge>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
