import { useState } from "react";
import { Pencil, Plus, Search } from "lucide-react";
import { useAuth } from "@/app/authContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { TruncationNotice } from "@/components/ui/TruncationNotice";
import { ITEM_TYPE_LABELS, PRICING_METHOD_LABELS } from "@/lib/domain";
import { listIsTruncated } from "@/lib/listCap";
import { formatOMR, fromDbAmount } from "@/lib/money";
import type { CatalogItemType } from "@/lib/dbTypes";
import { CatalogItemDialog } from "./CatalogItemDialog";
import {
  type CatalogListItem,
  useCatalogCategories,
  useCatalogItemsPage,
  useToggleCatalogItem,
} from "./catalog.api";

export function CatalogPage() {
  const { currentOrganization, canManageCommercial, canReadCost } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  const categoriesQuery = useCatalogCategories(orgId);
  const itemsQuery = useCatalogItemsPage(orgId, canReadCost);
  const toggleMutation = useToggleCatalogItem(orgId);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogListItem | null>(null);

  const items = itemsQuery.data?.rows ?? [];
  const itemsTruncated =
    itemsQuery.isSuccess &&
    listIsTruncated(itemsQuery.data?.rows.length ?? 0, itemsQuery.data?.total);

  const normalizedSearch = search.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const matchesSearch =
      normalizedSearch === "" ||
      item.name.includes(search.trim()) ||
      (item.name_en ?? "").toLowerCase().includes(normalizedSearch) ||
      (item.code ?? "").toLowerCase().includes(normalizedSearch);
    const matchesType = typeFilter === "ALL" || item.item_type === typeFilter;
    return matchesSearch && matchesType;
  });

  if (itemsQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="الكتالوج"
        description="إدارة الأصناف والخدمات والأسعار"
        actions={
          canManageCommercial ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-5 w-5" />
              صنف جديد
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث عن صنف..."
            className="pr-11"
            aria-label="بحث"
          />
        </div>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="sm:w-56"
          aria-label="تصفية حسب النوع"
        >
          <option value="ALL">كل الأنواع</option>
          {(Object.keys(ITEM_TYPE_LABELS) as CatalogItemType[]).map((t) => (
            <option key={t} value={t}>
              {ITEM_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </div>

      {itemsTruncated && (
        <div className="mb-4 space-y-3">
          <TruncationNotice
            message={`يتم عرض ${itemsQuery.data?.rows.length ?? 0} من ${itemsQuery.data?.total ?? "…"} صنفاً.`}
          />
          {itemsQuery.hasMore && (
            <Button
              variant="secondary"
              onClick={() => itemsQuery.loadMore()}
              disabled={itemsQuery.isFetching}
            >
              {itemsQuery.isFetching ? "جارٍ التحميل…" : "عرض المزيد من الأصناف"}
            </Button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? "لا توجد أصناف بعد" : "لا توجد نتائج مطابقة"}
          description={
            items.length === 0
              ? "ابدأ بإضافة أول صنف في الكتالوج"
              : "جرّب كلمة بحث أخرى أو تصفية مختلفة"
          }
          action={
            items.length === 0 && canManageCommercial ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-5 w-5" />
                صنف جديد
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <li key={item.id}>
              <ItemCard
                item={item}
                editable={canManageCommercial}
                showCost={canReadCost}
                toggling={toggleMutation.isPending}
                onEdit={() => {
                  setEditing(item);
                  setDialogOpen(true);
                }}
                onToggle={() =>
                  toggleMutation.mutate({
                    id: item.id,
                    status: item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      <CatalogItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        orgId={orgId}
        categories={categoriesQuery.data ?? []}
        item={editing}
      />
    </div>
  );
}

function ItemCard({
  item,
  editable,
  showCost,
  toggling,
  onEdit,
  onToggle,
}: {
  item: CatalogListItem;
  editable: boolean;
  showCost: boolean;
  toggling: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{item.name}</h3>
          <p className="text-sm text-slate-500">
            {ITEM_TYPE_LABELS[item.item_type]} ·{" "}
            {PRICING_METHOD_LABELS[item.pricing_method]}
            {item.unit ? ` · ${item.unit}` : ""}
          </p>
        </div>
        <Badge tone={item.status === "ACTIVE" ? "success" : "neutral"}>
          {item.status === "ACTIVE" ? "نشط" : "غير نشط"}
        </Badge>
      </div>

      <div
        className={`mb-3 grid gap-2 rounded-xl bg-slate-50 p-3 ${
          showCost ? "grid-cols-2" : "grid-cols-1"
        }`}
      >
        <div>
          <p className="text-sm text-slate-500">سعر البيع</p>
          <p className="text-lg font-bold text-brand-700">
            {formatOMR(fromDbAmount(item.selling_price))}
          </p>
        </div>
        {showCost && (
          <div>
            <p className="text-sm text-slate-500">التكلفة</p>
            <p className="text-lg font-bold text-slate-700">
              {formatOMR(fromDbAmount(item.cost_price))}
            </p>
          </div>
        )}
      </div>

      {editable && (
        <div className="mt-auto flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            تعديل
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            disabled={toggling}
            onClick={onToggle}
          >
            {item.status === "ACTIVE" ? "تعطيل" : "تفعيل"}
          </Button>
        </div>
      )}
    </div>
  );
}
