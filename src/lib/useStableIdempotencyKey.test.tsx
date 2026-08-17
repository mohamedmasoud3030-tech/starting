import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStableIdempotencyKey } from "./useStableIdempotencyKey";

describe("useStableIdempotencyKey", () => {
  it("keeps the same key across re-renders while the session is active", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useStableIdempotencyKey(active),
      { initialProps: { active: true } },
    );
    const first = result.current;
    rerender({ active: true });
    rerender({ active: true });
    expect(result.current).toBe(first);
  });

  it("rotates the key when the dialog reopens (new session)", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useStableIdempotencyKey(active),
      { initialProps: { active: false } },
    );
    const closedKey = result.current;

    rerender({ active: true });
    const sessionKey = result.current;
    expect(sessionKey).not.toBe(closedKey);

    rerender({ active: false });
    rerender({ active: true });
    expect(result.current).not.toBe(sessionKey);
    expect(result.current).not.toBe(closedKey);
  });

  it("does not rotate while the session stays open", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useStableIdempotencyKey(active),
      { initialProps: { active: true } },
    );
    const key = result.current;
    act(() => {
      rerender({ active: true });
    });
    expect(result.current).toBe(key);
  });
});
