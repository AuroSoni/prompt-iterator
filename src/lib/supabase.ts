// Single Supabase client for the app. Configured entirely from env vars; when
// they are absent `supabase` is null and the library store runs on in-memory
// seed data (so this public repo clones-and-runs with no backend).
//
// SECURITY: only the publishable anon key ever appears here. It is designed to
// be shipped in client code; a service-role key or access token must never be.

import { createClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/database.types"

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when both env vars are present, so persistence is active. */
export const isSupabaseConfigured = Boolean(url && anonKey)

/** The client, or null when unconfigured. Callers must handle the null case. */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(url as string, anonKey as string, {
      // No login flow — anon key only — so there is no session to persist.
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null
