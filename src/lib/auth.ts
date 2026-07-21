// Auth store — the single-user email+password gate.
//
// Only meaningful when Supabase is configured. When it isn't (`supabase === null`
// — the public clone-and-run case), there is NO gate: the store reports
// "signed-in" and hydrates the in-memory seed library immediately, exactly as
// before auth existed.
//
// The store OWNS library hydration: the library loads on the signed-out→in
// transition (or the unconfigured bypass) and is torn down on sign-out, so a
// signed-out client never touches the (authenticated-only) database.

import { useSyncExternalStore } from "react"

import { supabase } from "@/lib/supabase"
import { flushPendingNow, hydrate, resetLibrary } from "@/lib/library"

export type AuthStatus = "loading" | "signed-out" | "signed-in"

// Unconfigured ⇒ no gate: start signed-in (initAuth hydrates the seeds).
let status: AuthStatus = supabase ? "loading" : "signed-in"
// Tracks signed-in-ness so we react to genuine transitions only — and thereby
// ignore TOKEN_REFRESHED / USER_UPDATED, which keep the same session.
let wasSignedIn = false

export interface AuthSnapshot {
  status: AuthStatus
}

// Cached so useSyncExternalStore sees a stable reference between changes.
let snapshot: AuthSnapshot = { status }
const listeners = new Set<() => void>()

function emit(): void {
  snapshot = { status }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): AuthSnapshot {
  return snapshot
}

/** Reactive view of the auth gate. */
export function useAuth(): AuthSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot)
}

let initialized = false

/** Wire up auth once at startup. Idempotent (safe under StrictMode's double-invoke). */
export function initAuth(): void {
  if (initialized) return
  initialized = true

  if (!supabase) {
    // No backend: bypass the gate and load the seed library.
    void hydrate()
    return
  }

  // onAuthStateChange fires INITIAL_SESSION right after subscribing, so it also
  // covers "restore the persisted session on reload" — no separate getSession().
  supabase.auth.onAuthStateChange((_event, session) => {
    const nowSignedIn = session !== null
    // React to transitions only. NEVER await a Supabase call in here — the SDK
    // holds an internal lock during this callback and hydrate() queries the DB,
    // so defer every reaction to a fresh tick to avoid a deadlock.
    if (nowSignedIn && !wasSignedIn) {
      setTimeout(() => void hydrate(), 0)
    } else if (!nowSignedIn && wasSignedIn) {
      setTimeout(() => resetLibrary(), 0)
    }
    wasSignedIn = nowSignedIn

    const next: AuthStatus = nowSignedIn ? "signed-in" : "signed-out"
    if (next !== status) {
      status = next
      emit()
    }
  })
}

/** Sign in with email + password. Throws on failure (the message is shown by the
 *  login UI); on success the auth listener flips the gate to signed-in. */
export async function signIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.")
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}

/** Flush the last debounced edit, then sign out. The auth listener then tears
 *  the library down (resetLibrary). */
export async function signOut(): Promise<void> {
  if (!supabase) return
  await flushPendingNow()
  await supabase.auth.signOut()
}
