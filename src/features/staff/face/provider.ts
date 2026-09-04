/**
 * Narrow biometric provider boundary (Scope B).
 *
 * The product uses face recognition as an IDENTIFICATION AID for the office
 * manager only — a provider NEVER creates attendance by itself, and it never
 * feeds payroll (wages are computed from confirmed attendance in the database,
 * migration 0039/0082). This module exists so neither the UI nor the domain
 * logic depends on a concrete recognition engine: everything goes through the
 * `FaceRecognitionProvider` contract below.
 *
 * HONESTY POLICY (binding): production bundles ship NO engine, therefore
 * `resolveFaceProvider()` returns null and every assisted surface degrades to
 * the manual-first-class flow with a visible provider state. There is exactly
 * one rule that keeps this safe: a match score may only ever come out of a
 * registered real provider. Nothing here computes, randomizes or defaults a
 * "confidence" — an unavailable provider produces UNAVAILABLE, not a number.
 *
 * Tests (see provider.test.ts) register deterministic fake providers; the
 * test-only registry path is never reachable from the app.
 */

/** A captured face embedding produced by a provider for one enrollment frame. */
export type FaceDescriptor = readonly number[];

/** One candidate the provider may choose from (already scoped server-side). */
export interface FaceCandidate {
  staffMemberId: string;
  /** Templates captured during enrollment on THIS device (see localTemplates). */
  descriptors: readonly FaceDescriptor[];
}

export type FaceMatchOutcome =
  /** A candidate crossed the provider's own acceptance policy. */
  | { outcome: "MATCH"; staffMemberId: string; confidence: number }
  /** Nothing crossed the provider's acceptance policy — never a guess. */
  | { outcome: "NO_MATCH" };

export interface FaceRecognitionProvider {
  /** Stable machine code persisted with enrollment rows (e.g. "local-face-v1"). */
  readonly code: string;
  /** Engine/model version so descriptors are never mixed across model changes. */
  readonly modelVersion: string;
  /**
   * Extract one descriptor from a capture, or `null` when the frame contains
   * no usable face. Providers must NOT guess.
   */
  extractDescriptor(capture: Blob): Promise<FaceDescriptor | null>;
  /**
   * Compare a probe against the supplied candidates only. The candidate set is
   * what the server scoped for this event (assigned, active, enrolled) — a
   * provider never searches a wider population.
   */
  match(probe: FaceDescriptor, candidates: readonly FaceCandidate[]): Promise<FaceMatchOutcome>;
}

/**
 * Provider registry. Registration is an integration concern: a deployment
 * wires a real engine (e.g. an on-device model bundle) behind this function,
 * gated by its own availability probe. Production ships no registration.
 */
const registry: { factory: (() => Promise<FaceRecognitionProvider>) | null } = {
  factory: null,
};

/** Integration seam — for tests and a future gated deployment only. */
export function __registerFaceProviderFactory(
  factory: (() => Promise<FaceRecognitionProvider>) | null,
): void {
  registry.factory = factory;
}

/**
 * Resolve the effective provider for this deployment and device.
 * `null` means recognition is NOT available: every assisted flow must show
 * the honest provider state and fall back to the manual roster.
 */
export async function resolveFaceProvider(): Promise<FaceRecognitionProvider | null> {
  if (!registry.factory) return null;
  try {
    return await registry.factory();
  } catch {
    // A failing engine must never break event operations (§18) — treat it as
    // "no provider" and let the manual path proceed.
    return null;
  }
}
