import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReadinessReport } from "../readinessReport";
import { ReadinessReportPanel } from "./ReadinessReportPanel";

const incomplete: ReadinessReport = {
  overall: "INCOMPLETE",
  percent: 50,
  staffMissing: 3,
  equipmentShortage: 2,
  items: [
    { key: "staff", label: "الفريق (المضيفون والمشرفون)", required: 15, assigned: 12, status: "short" },
    { key: "equipment-1", label: "دلة قهوة", required: 5, assigned: 5, status: "ok" },
  ],
};

describe("ReadinessReportPanel", () => {
  it("shows the percentage, heading and the explainable checklist", () => {
    render(<ReadinessReportPanel report={incomplete} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("المناسبة غير مكتملة التجهيز")).toBeInTheDocument();
    expect(screen.getByText("الفريق (المضيفون والمشرفون)")).toBeInTheDocument();
    expect(screen.getByText("دلة قهوة")).toBeInTheDocument();
    // Both checklist items render their required-vs-assigned detail.
    expect(screen.getAllByText(/مطلوب/)).toHaveLength(2);
    expect(screen.getAllByText(/مخصص/)).toHaveLength(2);
  });

  it("is READY with 100% when nothing is short", () => {
    const ready: ReadinessReport = {
      overall: "READY",
      percent: 100,
      staffMissing: 0,
      equipmentShortage: 0,
      items: [{ key: "staff", label: "الفريق", required: 5, assigned: 5, status: "ok" }],
    };
    render(<ReadinessReportPanel report={ready} />);
    expect(screen.getByText("المناسبة جاهزة")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("shows no percentage for an event with no resource requirements", () => {
    const empty: ReadinessReport = {
      overall: "EMPTY",
      percent: null,
      staffMissing: 0,
      equipmentShortage: 0,
      items: [],
    };
    render(<ReadinessReportPanel report={empty} />);
    expect(screen.getByText("لا توجد متطلبات موارد مسجلة بعد")).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
  });
});
