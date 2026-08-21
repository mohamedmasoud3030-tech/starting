import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentActions } from "./DocumentActions";

describe("DocumentActions", () => {
  it("never includes costs or profit in the WhatsApp link", () => {
    render(
      <DocumentActions
        phone="91234567"
        message={"عرض سعر رقم Q-1\nالإجمالي 120.000 ر.ع."}
        shareTitle="عرض سعر"
      />,
    );
    const link = screen.getByRole("link", { name: "واتساب" });
    const href = decodeURIComponent(link.getAttribute("href") ?? "");
    expect(href).toContain("wa.me/96891234567");
    expect(href).toContain("عرض سعر");
    expect(href).not.toContain("ربح");
    expect(href).not.toContain("تكلفة");
  });

  it("does not pretend WhatsApp is available without a number", () => {
    render(
      <DocumentActions phone={null} message="مرحبا" shareTitle="عرض" />,
    );
    expect(screen.queryByRole("link", { name: "واتساب" })).not.toBeInTheDocument();
    expect(screen.getByText("لا يوجد رقم واتساب صالح")).toBeInTheDocument();
  });
});
