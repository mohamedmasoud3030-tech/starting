import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { useCatalogItems } from "@/features/catalog/catalog.api";
import type { CatalogListItem } from "@/features/catalog/catalog.api";
import { formatQuantity } from "@/lib/utils";
import { PackageDialog } from "./PackageDialog";
import { type PackageWithLines, usePackages } from "./packages.api";

export function PackagesPage() {
  const { currentOrganization, canManageCommercial } = useAuth();
  const orgId = currentOrganization?.id ?? null;

  const packagesQuery = usePackages(orgId);
  const itemsQuery = useCatalogItems(orgId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PackageWithLines | null>(null);

  if (packagesQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const packages = packagesQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="الباقات"
        description="قوالب جاهزة للمناسبات"
        actions={
          canManageCommercial ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-5 w-5" />
              باقة جديدة
            </Button>
          ) : undefined
        }
      />

      {packages.length === 0 ? (
        <EmptyState
          title="لا توجد باقات بعد"
          description="أنشئ باقة قابلة لإعادة الاستخدام مثل «ضيافة قهوة — 100 ضيف»"
          action={
            canManageCommercial ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-5 w-5" />
                باقة جديدة
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {packages.map((pkg) => (
            <li key={pkg.package.id}>
              <PackageCard
                pkg={pkg}
                catalogItems={itemsQuery.data ?? []}
                editable={canManageCommercial}
                onEdit={() => {
                  setEditing(pkg);
                  setDialogOpen(true);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <PackageDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        orgId={orgId}
        catalogItems={itemsQuery.data ?? []}
        target={editing}
      />
    </div>
  );
}

function PackageCard({
  pkg,
  catalogItems,
  editable,
  onEdit,
}: {
  pkg: PackageWithLines;
  catalogItems: CatalogListItem[];
  editable: boolean;
  onEdit: () => void;
}) {
  const itemNameById = new Map(catalogItems.map((i) => [i.id, i.name]));
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{pkg.package.name}</h3>
          {pkg.package.base_guest_count != null && (
            <p className="text-sm text-slate-500">
              {pkg.package.base_guest_count} ضيف (مرجعي)
            </p>
          )}
        </div>
        <Badge tone={pkg.package.status === "ACTIVE" ? "success" : "neutral"}>
          {pkg.package.status === "ACTIVE" ? "نشطة" : "غير نشطة"}
        </Badge>
      </div>

      {pkg.lines.length === 0 ? (
        <p className="mb-3 rounded-xl bg-slate-50 p-3 text-base text-slate-500">
          لا توجد أصناف في هذه الباقة بعد
        </p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {pkg.lines.map((line) => (
            <li
              key={line.id}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-base"
            >
              <span className="font-semibold text-slate-700">
                {itemNameById.get(line.catalog_item_id) ?? line.catalog_item_id}
              </span>
              <span className="font-bold text-slate-900">
                {formatQuantity(line.quantity)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="mt-auto">
          <Button variant="outline" size="sm" className="w-full" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            تعديل
          </Button>
        </div>
      )}
    </div>
  );
}
