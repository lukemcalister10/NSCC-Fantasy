import { createClient } from "@supabase/supabase-js";

/**
 * The ONLY Supabase client in the app: the anon/publishable key, browser-side.
 * Authorization is done entirely by RLS (migration 0004) — this slice contains
 * NO service-role usage and NO write paths. A logged-out client reads nothing
 * (D17); reads only succeed for an authenticated participant.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.",
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // magic-link callback lands back on the app URL
  },
});
