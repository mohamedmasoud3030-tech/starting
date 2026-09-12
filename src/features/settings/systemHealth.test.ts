import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_MIME_ALLOWED,
  attachmentStoragePath,
} from "@/features/attachments/attachments.api";
import {
  HEALTH_PROBE_BUCKET,
  HEALTH_PROBE_ENTITY,
  HEALTH_PROBE_EVIDENCE_TYPE,
  HEALTH_PROBE_MIME,
  classifyStorageFailure,
  healthProbePath,
  storageProbeBlob,
} from "./systemHealth";

/**
 * The storage self-test must probe through the SAME door the product uses.
 *
 * Migration 0074's `attachments_insert_org_role` policy casts the SECOND path
 * segment to the `attachment_evidence_type` enum, so a probe written under any
 * other shape is rejected by a perfectly healthy bucket — which is exactly the
 * false alarm this panel used to raise (it uploaded to `{org}/health/`).
 */
describe("storage health probe path", () => {
  it("matches the path builder every real evidence upload uses", () => {
    expect(healthProbePath("org-1", "probe.jpg")).toBe(
      attachmentStoragePath("org-1", HEALTH_PROBE_EVIDENCE_TYPE, HEALTH_PROBE_ENTITY, "probe.jpg"),
    );
  });

  it("puts a valid evidence type in segment 2 — the segment the INSERT policy casts", () => {
    const segments = healthProbePath("org-1", "probe.jpg").split("/");

    expect(segments).toHaveLength(4);
    expect(segments[0]).toBe("org-1");
    expect(segments[1]).toBe("EXPENSE_RECEIPT");
    expect(segments[2]).toBe("health_check");
    expect(segments[3]).toBe("probe.jpg");
  });

  it("probes an owner-writable financial type, never a restricted evidence type", () => {
    // EXPENSE_RECEIPT is writable by OWNER / MANAGER / ACCOUNTANT
    // (attachment_evidence_write_gate, 0074); payroll and facial-capture types
    // are restricted and would fail for most callers, faking a storage outage.
    expect(HEALTH_PROBE_EVIDENCE_TYPE).toBe("EXPENSE_RECEIPT");
  });

  it("writes to the shared private bucket under its own diagnostic folder", () => {
    expect(HEALTH_PROBE_BUCKET).toBe(ATTACHMENT_BUCKET);
    expect(ATTACHMENT_BUCKET).toBe("attachments");
    // Never inside a real record's folder: the probe must stay an unattached
    // object so the audited reclaim sweep can see and clean it.
    expect(HEALTH_PROBE_ENTITY).toBe("health_check");
  });
});

describe("storage health probe payload", () => {
  it("uses a MIME type the bucket's allow-list accepts", () => {
    expect(ATTACHMENT_MIME_ALLOWED).toContain(HEALTH_PROBE_MIME);
  });

  it("builds a small blob carrying that MIME type", () => {
    const blob = storageProbeBlob();

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(HEALTH_PROBE_MIME);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.size).toBeLessThan(1024);
  });
});

/**
 * A refusal is not an outage. Misclassifying an RLS/role refusal as an error
 * sends a non-technical founder into the dashboard to recreate a bucket that
 * already exists and is already correct.
 */
describe("classifyStorageFailure", () => {
  it("reports a missing bucket as an error with setup guidance", () => {
    const result = classifyStorageFailure(new Error('Bucket not found: "attachments"'));

    expect(result.status).toBe("error");
    expect(result.message).toContain("attachments");
    expect(result.message).toContain("Supabase Dashboard");
  });

  it.each([
    ["row-level security refusal", "new row violates row-level security policy for table objects"],
    ["permission denied", 'permission denied for schema storage / SQLSTATE "42501"'],
    ["bare SQLSTATE", "42501"],
  ])("reports %s as a warning, not an outage", (_label, message) => {
    const result = classifyStorageFailure(new Error(message));

    expect(result.status).toBe("warn");
    expect(result.message).toContain("OWNER");
  });

  it("accepts a plain string cause", () => {
    expect(classifyStorageFailure("Bucket not found").status).toBe("error");
    expect(classifyStorageFailure("permission denied").status).toBe("warn");
  });

  it("surfaces an unknown failure as an error including the raw message", () => {
    const result = classifyStorageFailure(new Error("ETIMEDOUT"));

    expect(result.status).toBe("error");
    expect(result.message).toContain("ETIMEDOUT");
  });

  it("never produces an empty message for an opaque cause", () => {
    const result = classifyStorageFailure({ code: "unexpected" });

    expect(result.status).toBe("error");
    expect(result.message.trim().length).toBeGreaterThan(0);
  });
});
