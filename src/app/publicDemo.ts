/**
 * Public demo mode — EXPLICITLY TEMPORARY, per-deployment opt-in.
 *
 * SECURITY: this flag must NEVER default to on in source. When enabled, any
 * anonymous visitor of a deployment reaches the configured Supabase project
 * with OWNER-equivalent application capability (scoped by RLS to the single
 * named demo organization) and the login screen is bypassed entirely.
 *
 * It is therefore gated behind an explicit build-time environment variable.
 * A deployment enables the temporary demo ONLY by setting
 * `VITE_PUBLIC_DEMO_MODE=true` at build time (e.g. a Vercel env var on the
 * demo project). Any other build — including the real production deploy —
 * runs the normal Supabase Auth flow.
 */
export const PUBLIC_DEMO_MODE =
  import.meta.env.VITE_PUBLIC_DEMO_MODE === "true";

/**
 * Temporary production demo tenant. This is a public UUID, not a credential.
 * Backend RLS grants anonymous OWNER-equivalent access only to this
 * organization.
 */
export const PUBLIC_DEMO_ORG_ID = "3e6bf585-c93a-4d8f-9ff7-41fcc9cb466b";
