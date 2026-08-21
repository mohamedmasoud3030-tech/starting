import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  attachmentFileError,
  attachmentStoragePath,
  dataUrlToFile,
  evidenceError,
} from "./attachments.api";

describe("attachmentStoragePath", () => {
  it("scopes every object under its own organization id", () => {
    const path = attachmentStoragePath("org-1", "STAFF_ID", "staff_member", "id.jpg");
    expect(path).toBe("org-1/STAFF_ID/staff_member/id.jpg");
  });
});

describe("attachmentFileError", () => {
  it("rejects oversized files", () => {
    const big = new File([new Uint8Array(ATTACHMENT_MAX_BYTES + 1)], "big.jpg", {
      type: "image/jpeg",
    });
    expect(attachmentFileError(big)).toMatch(/الحد الأقصى/);
  });

  it("rejects disallowed MIME types", () => {
    const evil = new File(["x"], "evil.exe", { type: "application/octet-stream" });
    expect(attachmentFileError(evil)).toMatch(/غير مدعوم/);
  });

  it("accepts approved image/PDF types", () => {
    expect(
      attachmentFileError(new File(["x"], "a.jpg", { type: "image/jpeg" })),
    ).toBeNull();
    expect(
      attachmentFileError(new File(["x"], "a.pdf", { type: "application/pdf" })),
    ).toBeNull();
  });
});

describe("dataUrlToFile (signature persistence contract)", () => {
  it("converts a canvas data URL into an uploadable File", () => {
    const file = dataUrlToFile("data:image/png;base64,QUJD", "signature.png");
    expect(file.name).toBe("signature.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(3); // "ABC"
  });
});

describe("evidenceError", () => {
  it("maps the no-false-success boundary to Arabic", () => {
    expect(evidenceError(new Error("ATTACHMENT_OBJECT_MISSING"))).toMatch(/أعد الرفع/);
    expect(evidenceError(new Error("SELFIE_REQUIRED"))).toMatch(/صورة الحضور/);
    expect(evidenceError(new Error("NOT_AUTHORIZED"))).toMatch(/صلاحية/);
  });
});
