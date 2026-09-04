/**
 * Device-local face TEMPLATE storage (enrollment data only).
 *
 * Deliberately separate from the two other media categories the product
 * already distinguishes:
 *   * attendance EVIDENCE photos → private storage bucket via the attachment
 *     layer (0074) — attached to the CONFIRMED punch, human-viewable, audited;
 *   * temporary camera FRAMES → never persisted, only read into the provider;
 *   * ENROLLMENT TEMPLATES → compact provider descriptors kept on THIS device
 *     (this module). Raw training captures are not retained after extraction:
 *     the frames are discarded the moment descriptors are produced, so nothing
 *     biometric is uploaded and nothing is kept beyond what the chosen
 *     provider actually needs.
 *
 * The server record (staff_face_enrollments, 0083) stores only the opaque
 * token + provider/model metadata — never descriptor bytes. If the device is
 * wiped or another device signs in, enrollment state surfaces honestly as
 * “needs (re-)enrollment on this device” and assisted matching degrades to
 * the manual flow until re-enrolled.
 */

import type { FaceDescriptor } from "./provider";

const KEY_PREFIX = "face-templates:v1";

export interface StoredFaceTemplates {
  providerCode: string;
  modelVersion: string;
  /** Opaque handle reported to the server as the enrollment template ref. */
  token: string;
  /** One descriptor per captured enrollment frame. */
  descriptors: FaceDescriptor[];
  enrolledAt: string;
}

function storageKey(orgId: string, staffMemberId: string): string {
  return `${KEY_PREFIX}:${orgId}:${staffMemberId}`;
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Private-mode / storage-unavailable devices still get the manual flow.
    return null;
  }
}

export function saveFaceTemplates(
  orgId: string,
  staffMemberId: string,
  value: Omit<StoredFaceTemplates, "enrolledAt">,
): StoredFaceTemplates {
  const stored: StoredFaceTemplates = { ...value, enrolledAt: new Date().toISOString() };
  store()?.setItem(storageKey(orgId, staffMemberId), JSON.stringify(stored));
  return stored;
}

/**
 * Load the device-local templates for one staff member, but ONLY when they
 * were produced by the SAME provider/model that is active now — descriptors
 * from a different model are meaningless across engines and are treated as
 * absent, never compared.
 */
export function loadFaceTemplates(
  orgId: string,
  staffMemberId: string,
  providerCode: string,
  modelVersion: string,
): StoredFaceTemplates | null {
  const raw = store()?.getItem(storageKey(orgId, staffMemberId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredFaceTemplates;
    if (
      parsed.providerCode !== providerCode ||
      parsed.modelVersion !== modelVersion ||
      !Array.isArray(parsed.descriptors) ||
      parsed.descriptors.length === 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearFaceTemplates(orgId: string, staffMemberId: string): void {
  store()?.removeItem(storageKey(orgId, staffMemberId));
}

/** Whether this device holds usable enrollment templates right now. */
export function hasDeviceTemplates(
  orgId: string | null,
  staffMemberId: string,
  providerCode: string,
  modelVersion: string,
): boolean {
  if (!orgId) return false;
  return loadFaceTemplates(orgId, staffMemberId, providerCode, modelVersion) !== null;
}
