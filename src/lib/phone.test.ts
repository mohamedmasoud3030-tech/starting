import { describe, expect, it } from "vitest";
import {
  normalizeOmanPhone,
  omanE164,
  omanTelUrl,
  omanWhatsAppUrl,
} from "./phone";

describe("normalizeOmanPhone", () => {
  it("keeps a bare 8-digit mobile number", () => {
    expect(normalizeOmanPhone("91234567")).toBe("91234567");
  });

  it("strips the +968 country code", () => {
    expect(normalizeOmanPhone("+96891234567")).toBe("91234567");
  });

  it("strips 968 and 00968 prefixes", () => {
    expect(normalizeOmanPhone("96891234567")).toBe("91234567");
    expect(normalizeOmanPhone("0096891234567")).toBe("91234567");
  });

  it("ignores spaces, dashes and parentheses", () => {
    expect(normalizeOmanPhone("+968 9123-4567")).toBe("91234567");
  });

  it("accepts 2xxxxxxx landlines", () => {
    expect(normalizeOmanPhone("24567890")).toBe("24567890");
  });

  it("rejects non-Oman or malformed numbers", () => {
    expect(normalizeOmanPhone("11234567")).toBeNull();
    expect(normalizeOmanPhone("9123456")).toBeNull();
    expect(normalizeOmanPhone("971501234567")).toBeNull();
    expect(normalizeOmanPhone(null)).toBeNull();
  });
});

describe("omanE164 / links", () => {
  it("builds an E.164 number", () => {
    expect(omanE164("91234567")).toBe("+96891234567");
  });

  it("builds tel: and wa.me links", () => {
    expect(omanTelUrl("91234567")).toBe("tel:+96891234567");
    expect(omanWhatsAppUrl("91234567")).toBe("https://wa.me/96891234567");
  });

  it("returns null for unusable numbers", () => {
    expect(omanTelUrl("abc")).toBeNull();
    expect(omanWhatsAppUrl("")).toBeNull();
  });
});
