import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProcurementWorkspace } from "./ProcurementWorkspace";
import { createTestSource } from "./__tests__/testDoubles";

describe("ProcurementWorkspace page", () => {
  it("loads server-derived access and exposes accessible Arabic tabs", async () => {
    const controls = createTestSource();
    const user = userEvent.setup();
    render(<ProcurementWorkspace dataSource={controls.source} />);

    expect(screen.getByText("جارٍ تحميل المشتريات…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "الموردون والمشتريات" })).toBeInTheDocument();
    const ordersTab = screen.getByRole("tab", { name: "الطلبات" });
    const suppliersTab = screen.getByRole("tab", { name: "الموردون" });
    expect(ordersTab).toHaveAttribute("aria-selected", "true");
    expect(ordersTab).toHaveClass("min-h-14");

    ordersTab.focus();
    await user.keyboard("{ArrowLeft}");
    expect(suppliersTab).toHaveFocus();
    expect(suppliersTab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "الموردون" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "procurement-tab-suppliers");
  });

  it("does not show create actions when the adapter denies them", async () => {
    const controls = createTestSource({
      access: {
        canViewCommercialAmounts: false,
        canCreateSupplier: false,
        canCreateOrder: false,
      },
    });
    const user = userEvent.setup();
    render(<ProcurementWorkspace dataSource={controls.source} />);
    await screen.findByText("طلبات التوريد");
    expect(screen.queryByRole("button", { name: "طلب جديد" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "الموردون" }));
    await screen.findByRole("heading", { name: "الموردون" });
    expect(screen.queryByRole("button", { name: "إضافة مورد" })).not.toBeInTheDocument();
  });

  it("maps an access failure to Arabic and offers retry", async () => {
    const controls = createTestSource();
    controls.failures.getAccess = new Error("PERMISSION_DENIED hidden policy");
    render(<ProcurementWorkspace dataSource={controls.source} />);
    expect(await screen.findByRole("heading", { name: "تعذر فتح المشتريات" })).toBeInTheDocument();
    expect(screen.getByText("لا تملك صلاحية تنفيذ هذا الإجراء.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toHaveClass("h-12");
    expect(document.body.textContent).not.toContain("hidden policy");
  });
});
