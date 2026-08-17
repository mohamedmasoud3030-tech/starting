import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./Field";
import { Input } from "./Input";
import { Select } from "./Select";
import { Textarea } from "./Textarea";

describe("Field error announcements", () => {
  it("wires aria-describedby from the field error to the input", () => {
    render(
      <Field label="الاسم" htmlFor="name" error="هذا الحقل مطلوب">
        <Input id="name" />
      </Field>,
    );

    const input = screen.getByRole("textbox", { name: "الاسم" });
    expect(input).toHaveAttribute("aria-describedby", "name-error");
    expect(document.getElementById("name-error")).toHaveTextContent(
      "هذا الحقل مطلوب",
    );
  });

  it("adds no aria-describedby when there is no error", () => {
    render(
      <Field label="الاسم" htmlFor="name">
        <Input id="name" />
      </Field>,
    );

    expect(screen.getByRole("textbox", { name: "الاسم" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("wires the error id for select and textarea controls", () => {
    render(
      <>
        <Field label="الحالة" htmlFor="st" error="اختر حالة">
          <Select id="st">
            <option value="a">أ</option>
          </Select>
        </Field>
        <Field label="ملاحظات" htmlFor="notes" error="الملاحظة مطلوبة">
          <Textarea id="notes" />
        </Field>
      </>,
    );

    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-describedby",
      "st-error",
    );
    expect(
      screen.getByRole("textbox", { name: "ملاحظات" }),
    ).toHaveAttribute("aria-describedby", "notes-error");
  });

  it("keeps an explicit aria-describedby from the caller", () => {
    render(
      <Field label="الاسم" htmlFor="name" error="مطلوب">
        <Input id="name" aria-describedby="help-name" />
      </Field>,
    );

    expect(screen.getByRole("textbox", { name: "الاسم" })).toHaveAttribute(
      "aria-describedby",
      "help-name",
    );
  });
});
