import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoidReasonPanel } from "./VoidReasonPanel";

describe("VoidReasonPanel (D35)", () => {
  it("does not confirm without a written reason", async () => {
    const onConfirm = vi.fn();
    render(
      <VoidReasonPanel
        title="تأكيد الإلغاء"
        confirmLabel="تأكيد الإلغاء"
        reasonLabel="سبب الإلغاء"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "تأكيد الإلغاء" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms with the trimmed reason once it is long enough", async () => {
    const onConfirm = vi.fn();
    render(
      <VoidReasonPanel
        title="تأكيد الإلغاء"
        confirmLabel="تأكيد الإلغاء"
        reasonLabel="سبب الإلغاء"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await userEvent.type(screen.getByLabelText(/سبب الإلغاء/), "  خطأ في الإدخال  ");
    await userEvent.click(screen.getByRole("button", { name: "تأكيد الإلغاء" }));
    expect(onConfirm).toHaveBeenCalledWith("خطأ في الإدخال");
  });

  it("cancels without calling confirm", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <VoidReasonPanel
        title="تأكيد الإلغاء"
        confirmLabel="تأكيد الإلغاء"
        reasonLabel="سبب الإلغاء"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "تراجع" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
