import { describe, expect, it } from "vitest";
import {
  ASSISTANT_NAME,
  ASSISTANT_PRODUCT,
  ASSISTANT_ROLE,
  buildAssistantAttribution,
} from "./assistant-identity";

describe("assistant identity", () => {
  it("has a name and a role", () => {
    expect(ASSISTANT_NAME.length).toBeGreaterThan(0);
    expect(ASSISTANT_ROLE.length).toBeGreaterThan(0);
  });

  it("attribution mentions the assistant and product — never a developer name", () => {
    const attribution = buildAssistantAttribution();
    expect(attribution).toContain(ASSISTANT_NAME);
    expect(attribution).toContain(ASSISTANT_PRODUCT);
    // No personal/brand credits on the client screens.
    expect(attribution).not.toMatch(/محمد|مسعود|Lena World|تطوير/);
  });
});
