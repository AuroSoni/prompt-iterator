/// <reference types="vite/client" />

// Typed env vars. Both are optional: when either is absent the app falls back
// to in-memory seed data (see src/lib/library.ts) so a fresh clone of this
// public repo runs with no Supabase project. Only the publishable anon key
// ever belongs in client code — never a service-role key or access token.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}
