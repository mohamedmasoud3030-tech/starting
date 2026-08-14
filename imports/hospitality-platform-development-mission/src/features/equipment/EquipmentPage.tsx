import { useMemo, useState } from "react";
import { useSession } from "@/app/session";
import { upsertEquipmentStock, useEngine } from "@/engine/engine";
import { canManageEquipmentCapacityFor } from "@/lib/domain";
import { errorMessage } from "@/lib/errors";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Field,
  Input,
  PageHeader,
} from "@/components/ui";

export function EquipmentPage() {
  const { session } = useSession();
  const state = useEngine();
  const canWrite = canManageEquipmentCapacityFor(session!.role);
  const items = useMemo(
    () =>
      state.catalogItems.filter(
        (i) =>
          i.organizationId === session!.organizationId &&
          i.itemType === "REUSABLE_EQUIPMENT",
      ),
    [state.catalogItems, session],
  );
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  return (
    <div>
      <PageHeader
        title="المعدات"
        subtitle="الكمية القابلة للحجز. الصرف والإرجاع الفعلي يأتي لاحقاً."
      />
      {error ? <Alert>{error}</Alert> : null}
      {saved ? <Alert tone="success">{saved}</Alert> : null}
      <div className="space-y-3">
        {items.map((item) => {
          const stock = state.equipmentStock.find(
            (e) =>
              e.organizationId === session!.organizationId &&
              e.catalogItemId === item.id,
          );
          const value = draft[item.id] ?? String(stock?.totalQuantity ?? 0);
          return (
            <Card key={item.id}>
              <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-extrabold">{item.nameAr}</h2>
                    <Badge tone={stock?.isActive === false ? "neutral" : "success"}>
                      {stock?.isActive === false ? "غير نشط" : "نشط"}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-500">إجمالي قابل للحجز</p>
                </div>
                <div className="flex items-end gap-2">
                  <Field label="الكمية">
                    <Input
                      className="w-28"
                      inputMode="numeric"
                      disabled={!canWrite}
                      value={value}
                      onChange={(e) =>
                        setDraft({ ...draft, [item.id]: e.target.value })
                      }
                    />
                  </Field>
                  {canWrite ? (
                    <Button
                      onClick={() => {
                        setError("");
                        setSaved("");
                        try {
                          upsertEquipmentStock(session, {
                            catalogItemId: item.id,
                            totalQuantity: Number(value),
                            isActive: stock?.isActive ?? true,
                          });
                          setSaved(`تم حفظ كمية ${item.nameAr}`);
                        } catch (e) {
                          setError(errorMessage(e));
                        }
                      }}
                    >
                      حفظ
                    </Button>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
