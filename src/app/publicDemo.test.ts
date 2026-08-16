import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Guards the P0 security invariant: PUBLIC_DEMO_MODE is a per-deployment
 * opt-in that must never default on in source. Anonymous demo access reaches
 * the same Supabase project with OWNER-equivalent capability, so an
 * accidental default-on would silently bypass login in any deployment.
 */
describe("publicDemo mode gating", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadDemoMode() {
    vi.resetModules();
    const mod = await import("./publicDemo");
    return mod.PUBLIC_DEMO_MODE;
  }

  it("is OFF by default (env unset)", async () => {
    vi.stubEnv("VITE_PUBLIC_DEMO_MODE", undefined);
    expect(await loadDemoMode()).toBe(false);
  });

  it("is OFF for any value other than the exact string 'true'", async () => {
    for (const value of ["1", "TRUE", "yes", "on", "true ", "demo", "false"]) {
      vi.stubEnv("VITE_PUBLIC_DEMO_MODE", value);
      expect(await loadDemoMode(), `value: ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("is ON only when VITE_PUBLIC_DEMO_MODE is exactly 'true'", async () => {
    vi.stubEnv("VITE_PUBLIC_DEMO_MODE", "true");
    expect(await loadDemoMode()).toBe(true);
  });

  it("keeps the demo organization id constant (RLS scope anchor)", async () => {
    vi.resetModules();
    const mod = await import("./publicDemo");
    expect(mod.PUBLIC_DEMO_ORG_ID).toBe(
      "3e6bf585-c93a-4d8f-9ff7-41fcc9cb466b",
    );
  });
});
