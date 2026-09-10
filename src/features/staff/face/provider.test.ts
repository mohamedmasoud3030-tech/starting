import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __registerFaceProviderFactory,
  resolveFaceProvider,
  type FaceDescriptor,
  type FaceMatchOutcome,
  type FaceRecognitionProvider,
} from "./provider";

/**
 * The narrow biometric provider boundary.
 *
 * These tests pin the HONESTY POLICY that keeps the assisted flow safe:
 *   * production ships NO engine, so resolveFaceProvider() returns null and
 *     every assisted surface must degrade to the manual roster;
 *   * a match score (confidence) may ONLY ever originate from a real registered
 *     provider — the boundary never computes, randomizes or defaults one;
 *   * a failing engine degrades to "no provider", never to a fake match.
 */

/** Deterministic fake engine for tests only — never reachable from the app. */
function fakeProvider(overrides: Partial<FaceRecognitionProvider> = {}): FaceRecognitionProvider {
  const noFace = (): FaceDescriptor | null => null;
  return {
    code: "local-face-v1",
    modelVersion: "m2",
    extractDescriptor: vi.fn<FaceRecognitionProvider["extractDescriptor"]>(
      async (capture: Blob) => {
        if (capture.size === 0) return noFace();
        return [0.1, 0.2];
      },
    ),
    match: vi.fn<FaceRecognitionProvider["match"]>(async () => ({ outcome: "NO_MATCH" })),
    ...overrides,
  };
}

beforeEach(() => {
  // Start every test from the production-like state (no engine registered).
  __registerFaceProviderFactory(null);
});

describe("resolveFaceProvider (provider boundary + honesty)", () => {
  it("returns null when no engine is registered (production state)", async () => {
    expect(await resolveFaceProvider()).toBeNull();
  });

  it("returns the registered provider once a deployment wires it", async () => {
    const provider = fakeProvider();
    __registerFaceProviderFactory(async () => provider);
    expect(await resolveFaceProvider()).toBe(provider);
  });

  it("never fabricates a confidence — an absent provider is null, not a match", async () => {
    // Even after attempting to resolve, no provider and no number may exist.
    const resolved = await resolveFaceProvider();
    expect(resolved).toBeNull();
  });

  it("degrades to 'no provider' when the registered engine throws", async () => {
    __registerFaceProviderFactory(async () => {
      throw new Error("engine crash");
    });
    expect(await resolveFaceProvider()).toBeNull();
  });

  it("a registered provider returns NO_MATCH without inventing a confidence", async () => {
    const provider = fakeProvider({
      match: vi.fn(async (): Promise<FaceMatchOutcome> => ({ outcome: "NO_MATCH" })),
    });
    __registerFaceProviderFactory(async () => provider);

    const resolved = await resolveFaceProvider();
    expect(resolved).not.toBeNull();
    const outcome = await resolved!.match([0.5], []);
    expect(outcome).toEqual({ outcome: "NO_MATCH" });
  });

  it("a MATCH confidence is passed through ONLY from the provider, never synthesized", async () => {
    // The provider is the single allowed origin of a numeric score.
    const provider = fakeProvider({
      match: vi.fn(
        async (): Promise<FaceMatchOutcome> => ({
          outcome: "MATCH",
          staffMemberId: "staff-1",
          confidence: 0.93,
        }),
      ),
    });
    __registerFaceProviderFactory(async () => provider);

    const resolved = await resolveFaceProvider();
    expect(resolved).not.toBeNull();
    const outcome = await resolved!.match([0.5], [{ staffMemberId: "staff-1", descriptors: [[0.1]] }]);
    expect(outcome).toEqual({ outcome: "MATCH", staffMemberId: "staff-1", confidence: 0.93 });
  });

  it("extractDescriptor passes the raw provider decision through (null = no face)", async () => {
    const provider = fakeProvider();
    __registerFaceProviderFactory(async () => provider);

    const resolved = await resolveFaceProvider();
    const fromFace = await resolved!.extractDescriptor(new Blob(["data"], { type: "image/png" }));
    expect(fromFace).toEqual([0.1, 0.2]);
    const fromEmpty = await resolved!.extractDescriptor(new Blob([]));
    expect(fromEmpty).toBeNull();
  });
});
