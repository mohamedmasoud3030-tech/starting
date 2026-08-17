import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { FormEvent } from "react";
import { useQuotationDraft } from "./useQuotationDraft";

/**
 * Unsaved-edit guard regression tests (defect D4): the draft editor must
 * engage a navigation/beforeunload blocker exactly while there are unsaved
 * edits, and clear it after a successful persist.
 */

vi.mock("@/app/authContext", () => ({
  useAuth: () => ({
    currentOrganization: { id: "org-1", name: "دار الضيافة العصرية" },
    canManageCommercial: true,
  }),
}));

const navigate = vi.fn();
const blockerStates = vi.hoisted(() => ({
  calls: [] as Array<{
    shouldBlockFn: () => boolean;
    enableBeforeUnload: () => boolean;
  }>,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useBlocker: (opts: {
    shouldBlockFn: () => boolean;
    enableBeforeUnload: () => boolean;
  }) => {
    blockerStates.calls.push(opts);
  },
}));

const persistMock = vi.fn();

vi.mock("./quotes.api", () => ({
  useQuotation: () => ({ data: null, isLoading: false }),
  useQuotationLines: () => ({ data: null, isLoading: false }),
  usePersistQuotationDraft: () => ({ mutateAsync: persistMock }),
  useIssueQuotation: () => ({ mutateAsync: vi.fn() }),
  useCancelQuotationDraft: () => ({ mutateAsync: vi.fn() }),
  arabicQuotationError: (cause: unknown) =>
    cause instanceof Error ? cause.message : String(cause),
}));

vi.mock("@/features/packages/packages.api", () => ({
  usePackages: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/features/catalog/catalog.api", () => ({
  useCatalogItems: () => ({ data: { rows: [], total: null }, isLoading: false }),
}));

function lastBlocker() {
  return blockerStates.calls[blockerStates.calls.length - 1]!;
}

function renderDraft() {
  return renderHook(() => useQuotationDraft());
}

describe("useQuotationDraft unsaved-edit guard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("starts clean: no blocker engaged", () => {
    const { result } = renderDraft();
    expect(result.current.dirty).toBe(false);
    expect(lastBlocker().shouldBlockFn()).toBe(false);
    expect(lastBlocker().enableBeforeUnload()).toBe(false);
  });

  it("engages the blocker on form edits", () => {
    const { result } = renderDraft();
    act(() => {
      result.current.setField("prospectName", "مريم");
    });
    expect(result.current.dirty).toBe(true);
    expect(lastBlocker().shouldBlockFn()).toBe(true);
    expect(lastBlocker().enableBeforeUnload()).toBe(true);
  });

  it("engages the blocker on guest count edits", () => {
    const { result } = renderDraft();
    act(() => {
      result.current.setGuestCount("120");
    });
    expect(result.current.dirty).toBe(true);
    expect(lastBlocker().shouldBlockFn()).toBe(true);
  });

  it("engages the blocker when a custom line is added", () => {
    const { result } = renderDraft();

    const form = document.createElement("form");
    const fields: ReadonlyArray<readonly [string, string]> = [
      ["description", "ضيافة قهوة"],
      ["quantity", "10"],
      ["price", "2.500"],
    ];
    for (const [name, value] of fields) {
      const input = document.createElement("input");
      input.name = name;
      input.value = value;
      form.append(input);
    }
    const event = {
      preventDefault: vi.fn(),
      currentTarget: form,
    } as unknown as FormEvent<HTMLFormElement>;

    act(() => {
      result.current.addCustomLine(event);
    });
    expect(result.current.lines).toHaveLength(1);
    expect(result.current.dirty).toBe(true);
    expect(lastBlocker().shouldBlockFn()).toBe(true);
  });

  it("clears the blocker after a successful save", async () => {
    persistMock.mockResolvedValueOnce({ id: "quote-1" });
    const { result } = renderDraft();

    act(() => {
      result.current.setField("prospectName", "مريم");
    });
    expect(result.current.dirty).toBe(true);

    await act(async () => {
      await result.current.onSaveDraft();
    });

    expect(result.current.dirty).toBe(false);
    expect(lastBlocker().shouldBlockFn()).toBe(false);
    expect(lastBlocker().enableBeforeUnload()).toBe(false);
    // New drafts navigate to their saved identity exactly once.
    expect(navigate).toHaveBeenCalledWith({
      to: "/quotes/$quoteId",
      params: { quoteId: "quote-1" },
    });
  });
});

describe("useQuotationDraft autosave (D22)", () => {
  beforeEach(() => {
    persistMock.mockClear();
  });
  it("persists silently once edits settle and clears the dirty flag", async () => {
    vi.useFakeTimers();
    persistMock.mockResolvedValue({ id: "quote-auto" });

    const { result } = renderDraft();
    act(() => {
      result.current.setField("prospectName", "مريم");
    });

    // Not yet: the debounce has not elapsed.
    expect(persistMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // Flush the microtask chain (async persist + state updates).
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(result.current.dirty).toBe(false);
  });

  it("does not autosave while the draft is not persistable", async () => {
    vi.useFakeTimers();

    const { result } = renderDraft();
    act(() => {
      result.current.setGuestCount("120");
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(persistMock).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(true);
  });
});
