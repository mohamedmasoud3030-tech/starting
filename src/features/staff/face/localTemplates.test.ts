import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFaceTemplates,
  hasDeviceTemplates,
  loadFaceTemplates,
  saveFaceTemplates,
} from "./localTemplates";

/**
 * Device-local face TEMPLATE storage (enrollment data only).
 *
 * These tests pin the honesty invariants that keep assisted attendance safe:
 *   * templates are keyed per org+staff member on THIS device only;
 *   * descriptors from a DIFFERENT provider or model are treated as ABSENT and
 *     never compared (cross-model descriptors are meaningless);
 *   * clearing removes only the intended key.
 * No biometric bytes ever reach the server — only the device store is tested.
 */

const ORG = "org-1";
const STAFF = "staff-9";
const BASE = {
  providerCode: "local-face-v1",
  modelVersion: "m2",
  token: "tok-abc",
  descriptors: [
    [1, 2, 3],
    [4, 5, 6],
  ],
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("localTemplates (device template store)", () => {
  it("saveFaceTemplates persists under a per-org+staff key and stamps enrolledAt", () => {
    const stored = saveFaceTemplates(ORG, STAFF, BASE);
    expect(stored.enrolledAt).toBeTruthy();
    expect(typeof new Date(stored.enrolledAt).getTime()).toBe("number");

    const raw = window.localStorage.getItem("face-templates:v1:org-1:staff-9");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.providerCode).toBe("local-face-v1");
    expect(parsed.descriptors).toHaveLength(2);
  });

  it("loadFaceTemplates returns stored templates when provider+model match", () => {
    saveFaceTemplates(ORG, STAFF, BASE);
    const loaded = loadFaceTemplates(ORG, STAFF, "local-face-v1", "m2");
    expect(loaded?.token).toBe("tok-abc");
    expect(loaded?.descriptors).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("returns null when nothing is stored for that staff member", () => {
    expect(loadFaceTemplates(ORG, STAFF, "local-face-v1", "m2")).toBeNull();
  });

  it("treats templates from a DIFFERENT provider as absent (never compared)", () => {
    saveFaceTemplates(ORG, STAFF, BASE);
    expect(loadFaceTemplates(ORG, STAFF, "some-other-engine", "m2")).toBeNull();
  });

  it("treats templates from a DIFFERENT model version as absent", () => {
    saveFaceTemplates(ORG, STAFF, BASE);
    expect(loadFaceTemplates(ORG, STAFF, "local-face-v1", "m1")).toBeNull();
  });

  it("treats an empty descriptor list as absent", () => {
    saveFaceTemplates(ORG, STAFF, { ...BASE, descriptors: [] });
    expect(loadFaceTemplates(ORG, STAFF, "local-face-v1", "m2")).toBeNull();
  });

  it("ignores a corrupt stored payload instead of comparing garbage", () => {
    window.localStorage.setItem(
      "face-templates:v1:org-1:staff-9",
      "{not-json",
    );
    expect(loadFaceTemplates(ORG, STAFF, "local-face-v1", "m2")).toBeNull();
  });

  it("clearFaceTemplates removes only the intended key", () => {
    saveFaceTemplates(ORG, STAFF, BASE);
    saveFaceTemplates(ORG, "staff-8", BASE);
    clearFaceTemplates(ORG, STAFF);
    expect(loadFaceTemplates(ORG, STAFF, "local-face-v1", "m2")).toBeNull();
    expect(loadFaceTemplates(ORG, "staff-8", "local-face-v1", "m2")).not.toBeNull();
  });

  it("hasDeviceTemplates reflects a matching stored enrollment", () => {
    expect(hasDeviceTemplates(ORG, STAFF, "local-face-v1", "m2")).toBe(false);
    saveFaceTemplates(ORG, STAFF, BASE);
    expect(hasDeviceTemplates(ORG, STAFF, "local-face-v1", "m2")).toBe(true);
    // A different model is NOT usable on this device.
    expect(hasDeviceTemplates(ORG, STAFF, "local-face-v1", "other")).toBe(false);
  });

  it("hasDeviceTemplates is false without an org context", () => {
    saveFaceTemplates(ORG, STAFF, BASE);
    expect(hasDeviceTemplates(null, STAFF, "local-face-v1", "m2")).toBe(false);
  });
});
