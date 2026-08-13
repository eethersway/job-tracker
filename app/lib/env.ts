/**
 * Supabase connection settings.
 *
 * Falls back to obviously-fake placeholder values so the app can be built
 * (and its pages prerendered) without a real Supabase project configured.
 * At runtime, requests made with placeholders will simply fail and surface
 * as error states in the UI.
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

/** True when real-looking credentials are configured. */
export function isSupabaseConfigured(): boolean {
  return (
    SUPABASE_URL !== "https://placeholder.supabase.co" &&
    SUPABASE_ANON_KEY !== "placeholder-anon-key"
  );
}
