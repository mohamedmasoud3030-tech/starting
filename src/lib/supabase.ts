import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * True only when real Supabase credentials are configured. When false, the
 * app shows a clear "not configured" state on the login screen — there is
 * NO demo/fallback authentication path.
 */
export const isSupabaseConfigured = Boolean(
  rawUrl &&
    rawAnonKey &&
    !rawUrl.includes("your-project") &&
    !rawAnonKey.includes("your-anon-key"),
);

// Placeholder values keep the client constructible in an unconfigured
// environment; isSupabaseConfigured gates every actual network call.
const supabaseUrl = isSupabaseConfigured
  ? rawUrl!
  : "https://placeholder.supabase.co";
const supabaseAnonKey = isSupabaseConfigured ? rawAnonKey! : "placeholder-anon-key";

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
