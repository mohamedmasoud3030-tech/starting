import { describe, expect, it } from "vitest";
import {
  ASSISTANT_DEVELOPER,
  ASSISTANT_NAME,
  ASSISTANT_ROLE,
  buildAssistantAttribution,
} from "./assistant-identity";

describe("assistant identity", () => {
  it("has a name, role and developer", () => {
    expect(ASSISTANT_NAME.length).toBeGreaterThan(0);
    expect(ASSISTANT_ROLE.length).toBeGreaterThan(0);
    expect(ASSISTANT_DEVELOPER.length).toBeGreaterThan(0);
  });

  it("attribution mentions the product, platform and developer", () => {
    const attribution = buildAssistantAttribution();
    expect(attribution).toContain(ASSISTANT_NAME);
    expect(attribution).toContain(ASSISTANT_DEVELOPER);
    expect(attribution).toContain("Lena World");
  });
});
