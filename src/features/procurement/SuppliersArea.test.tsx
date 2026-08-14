import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuppliersArea } from "./SuppliersArea";
import {
  createTestSource,
  fullAccess,
  supplierFixture,
} from "./__tests__/testDoubles";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("SuppliersArea", () => {
  it("shows a labeled loading state, then the Arabic supplier card without internal IDs", async () => {
    const controls = createTestSource();
    const pending = deferred<Awaited<ReturnType<typeof controls.source.listSuppliers>>>();
    controls.source.listSuppliers = () => pending.promise;
    render(<SuppliersArea dataSource={controls.source} access={fullAccess} />);

    expect(screen.getByText("جارٍ تحميل الموردين…")).toBeInTheDocument();
    pending.resolve(controls.suppliers);

    expect(await screen.findByText("مؤسسة النخبة للضيافة")).toBeInTheDocument();
    expect(screen.getAllByText("تموين وضيافة").length).toBeGreaterThan(0);
    expect(screen.getByText("الطلبات المفتوحة")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("supplier-internal-id");
  });

  it("renders empty and safe error states with recovery actions", async () => {
    const empty = createTestSource({ suppliers: [] });
    const { rerender } = render(<SuppliersArea dataSource={empty.source} access={fullAccess} />);
    expect(await screen.findByText("لا يوجد موردون بعد")).toBeInTheDocument();

    const broken = createTestSource();
    broken.failures.listSuppliers = new Error("NETWORK_ERROR socket detail");
    rerender(<SuppliersArea dataSource={broken.source} access={fullAccess} />);
    expect(await screen.findByText("تعذر تحميل الموردين")).toBeInTheDocument();
    expect(screen.getByText(/تعذر الاتصال بالخدمة/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("socket detail");
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toHaveClass("h-12");
  });

  it("searches and filters supplier cards", async () => {
    const controls = createTestSource({
      suppliers: [
        supplierFixture(),
        supplierFixture({ id: "second-internal", name: "مورد المياه", kind: "CONSUMABLES", status: "INACTIVE" }),
      ],
    });
    const user = userEvent.setup();
    render(<SuppliersArea dataSource={controls.source} access={fullAccess} />);
    await screen.findByText("مؤسسة النخبة للضيافة");

    await user.type(screen.getByLabelText("بحث"), "المياه");
    expect(screen.getByText("مورد المياه")).toBeInTheDocument();
    expect(screen.queryByText("مؤسسة النخبة للضيافة")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("الحالة"), "ACTIVE");
    expect(screen.getByText("لا توجد نتائج مطابقة")).toBeInTheDocument();
  });

  it("validates and creates a supplier through the adapter", async () => {
    const controls = createTestSource();
    const user = userEvent.setup();
    render(<SuppliersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: "إضافة مورد" }));
    await user.click(screen.getByRole("button", { name: "إضافة المورد" }));
    expect(await screen.findByText("اسم المورد مطلوب (حرفان على الأقل).")).toBeInTheDocument();
    expect(screen.getByText("اختر نوع المورد.")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/اسم المورد/), "مورد جديد");
    await user.selectOptions(screen.getByLabelText(/نوع المورد/), "SERVICES");
    await user.type(screen.getByLabelText("رقم الهاتف"), "99112233");
    await user.click(screen.getByRole("button", { name: "إضافة المورد" }));

    await waitFor(() => expect(controls.calls.createSupplier).toHaveBeenCalledWith(expect.objectContaining({
      name: "مورد جديد",
      kind: "SERVICES",
      phone: "99112233",
    })));
  });

  it("loads detail, enters edit state, and saves changed data", async () => {
    const controls = createTestSource();
    const user = userEvent.setup();
    render(<SuppliersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: /عرض تفاصيل المورد/ }));
    const dialog = await screen.findByRole("dialog", { name: "تفاصيل المورد" });
    expect(within(dialog).getByText("أحمد")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "تعديل البيانات" }));
    expect(await screen.findByRole("dialog", { name: "تعديل المورد" })).toBeInTheDocument();
    const name = screen.getByLabelText(/اسم المورد/);
    await user.clear(name);
    await user.type(name, "المورد المعدل");
    await user.click(screen.getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(controls.calls.updateSupplier).toHaveBeenCalledWith(
      "supplier-internal-id",
      expect.objectContaining({ name: "المورد المعدل" }),
    ));
  });

  it("requires explicit confirmation before deactivation", async () => {
    const controls = createTestSource();
    const user = userEvent.setup();
    render(<SuppliersArea dataSource={controls.source} access={fullAccess} />);
    await user.click(await screen.findByRole("button", { name: /عرض تفاصيل المورد/ }));
    await user.click(await screen.findByRole("button", { name: "إيقاف المورد" }));
    expect(screen.getByText(/هل تريد إيقاف/)).toBeInTheDocument();
    expect(controls.suppliers[0]?.status).toBe("ACTIVE");
    await user.click(screen.getByRole("button", { name: "نعم، أوقف المورد" }));
    await waitFor(() => expect(controls.suppliers[0]?.status).toBe("INACTIVE"));
  });
});
