import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Shared RPC call helper for feature data layers.
 *
 * Every business write in this application is a server-authoritative
 * SECURITY DEFINER command reached through `supabase.rpc`. Feature APIs used
 * to each carry their own copy of this 4-line wrapper; this is the single
 * canonical one.
 *
 * The dynamic dispatch (`name: string`) is intentional and kept local to this
 * helper: the Supabase client itself remains fully generated/typed, and only
 * this generic boundary erases the per-RPC overload. Callers supply the
 * result type they expect from the authoritative contract.
 */
const db: SupabaseClient = supabase;

export async function callRpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data as T;
}
