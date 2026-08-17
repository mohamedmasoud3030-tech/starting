import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EquipmentTab } from "./EquipmentTab";
import type { Capacity, Reservation } from "../events.api";

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({ currentOrganization: { id: "org-1" } }),
}));

const mutateAsync = vi.fn();

vi.mock("@/features/catalog/catalog.api", () => ({
  useCatalogItems: () => ({
    data: {
      rows: [
        { id: "cat-1", name: "دلة قهوة", item_type: "REUSABLE_EQUIPMENT", status: "ACTIVE" },
        { id: "cat-2", name: "قهوة", item_type: "CONSUMABLE", status: "ACTIVE" },
      ],
      total: 2,
    },
    isLoading: false,
  }),
}));

vi.mock("@/features/warehouse/warehouse.api", () => ({
  useSaveEquipmentCapacity: () => ({ mutateAsync, isPending: false }),
}));

function capacity(id: string, catalogItemId: string, total: number): Capacity {
  return { id, catalog_item_id: catalogItemId, total_quantity: total, catalog_items: { name: "دلة قهوة" } };
}

const run = vi.fn().mockResolvedValue(undefined);
const noReservations: Reservation[] = [];

describe("EquipmentTab — capacity provisioning (F11)", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    mutateAsync.mockResolvedValue(undefined);
    run.mockClear();
  });

  it("hides the provisioning form from non-commercial roles", () => {
    render(
      <EquipmentTab
        orgId="org-1"
        capacities={[]}
        reservations={noReservations}
        canProvision={false}
        run={run}
      />,
    );
    expect(screen.queryByText("سعة المعدات")).not.toBeInTheDocument();
  });

  it("lists only reusable equipment items for provisioning", async () => {
    render(
      <EquipmentTab
        orgId="org-1"
        capacities={[]}
        reservations={noReservations}
        canProvision={true}
        run={run}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("المعدة"), "cat-1");
    const options = screen
      .getByLabelText("المعدة")
      .querySelectorAll("option");
    const labels = Array.from(options).map((o) => o.textContent);
    expect(labels).toContain("دلة قهوة");
    expect(labels).not.toContain("قهوة");
  });

  it("inserts a new capacity row when the item has none", async () => {
    render(
      <EquipmentTab
        orgId="org-1"
        capacities={[]}
        reservations={noReservations}
        canProvision={true}
        run={run}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("المعدة"), "cat-1");
    await userEvent.type(screen.getByLabelText("السعة الكلية"), "40");
    await userEvent.click(screen.getByRole("button", { name: "حفظ السعة" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      existingId: null,
      values: { catalogItemId: "cat-1", totalQuantity: 40 },
    });
  });

  it("updates the existing row instead of duplicating it", async () => {
    render(
      <EquipmentTab
        orgId="org-1"
        capacities={[capacity("cap-1", "cat-1", 40)]}
        reservations={noReservations}
        canProvision={true}
        run={run}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("المعدة"), "cat-1");
    expect(screen.getByRole("button", { name: "تحديث السعة" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("السعة الكلية"), "55");
    await userEvent.click(screen.getByRole("button", { name: "تحديث السعة" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      existingId: "cap-1",
      values: { catalogItemId: "cat-1", totalQuantity: 55 },
    });
  });

  it("rejects a negative capacity without calling the server", async () => {
    render(
      <EquipmentTab
        orgId="org-1"
        capacities={[]}
        reservations={noReservations}
        canProvision={true}
        run={run}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("المعدة"), "cat-1");
    await userEvent.type(screen.getByLabelText("السعة الكلية"), "-5");
    await userEvent.click(screen.getByRole("button", { name: "حفظ السعة" }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("أدخل سعة صحيحة (صفر أو أكثر)")).toBeInTheDocument();
  });
});
