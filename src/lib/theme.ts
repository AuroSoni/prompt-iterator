// Theme preference: which of the two token blocks in index.css is live. The
// *preference* is three-way (light / dark / follow the OS); the *resolved*
// theme is always light or dark. Applying it is one class on <html> — every
// token block and Tailwind's `dark:` variant (`&:is(.dark *)`) hang off that
// ancestor, so nothing else in the app has to know a theme exists.
//
// Same module-store idiom as ui-prefs.ts (module state + emit/subscribe +
// useSyncExternalStore), but with a DOM side effect and an OS listener, which
// is why it isn't just another UiPrefs field.
//
// A twin of the resolution below runs as an inline script in index.html so the
// very first paint is already correct (the module bundle is deferred, so
// without it a dark-mode user gets a white flash). Keep THEME_KEY, the stored
// value's shape, and the resolve rule in sync with that script.

import { useSyncExternalStore } from "react"

import { readJSON, writeJSON } from "@/lib/local"

export type ThemePref = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

export interface ThemeState {
  pref: ThemePref
  /** What the OS currently reports, regardless of `pref`. Exposed so UI can
   *  label the "match system" choice with what it would actually give you. */
  system: ResolvedTheme
  /** The theme actually on screen — what `.dark` is keyed to. */
  resolved: ResolvedTheme
}

/** Mirrored by the pre-paint script in index.html. */
export const THEME_KEY = "pw:v1:theme"

const DARK_QUERY = "(prefers-color-scheme: dark)"

const isPref = (v: unknown): v is ThemePref =>
  v === "light" || v === "dark" || v === "system"

const systemDark = (): boolean => window.matchMedia(DARK_QUERY).matches

function computeState(pref: ThemePref): ThemeState {
  const system: ResolvedTheme = systemDark() ? "dark" : "light"
  return { pref, system, resolved: pref === "system" ? system : pref }
}

/** Anything unrecognized (missing key, corrupt JSON, older schema) falls back
 *  to "system" — respecting the OS is the right default for a first run. */
const storedPref = ((): ThemePref => {
  const raw = readJSON<unknown>(THEME_KEY)
  return isPref(raw) ? raw : "system"
})()

// One snapshot object, replaced only on real change: useSyncExternalStore
// compares by identity, so returning a fresh object per read would loop.
let snapshot: ThemeState = computeState(storedPref)

const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function emit(): void {
  for (const fn of listeners) fn()
}

function applyClass(): void {
  document.documentElement.classList.toggle("dark", snapshot.resolved === "dark")
}

/** Re-resolve `pref` against the OS, then repaint + notify if anything moved.
 *  `system` is part of the comparison, not just `resolved`: with pref "light"
 *  an OS flip changes nothing on screen but still has to reach the UI, which
 *  labels the system option with it. */
function sync(pref: ThemePref): void {
  const next = computeState(pref)
  if (
    next.pref === snapshot.pref &&
    next.resolved === snapshot.resolved &&
    next.system === snapshot.system
  ) {
    return
  }
  snapshot = next
  applyClass()
  emit()
}

/** Wire the theme once at startup, before first render. Idempotent under
 *  StrictMode. The OS listener stays attached for the process lifetime: when
 *  the pref isn't "system", resolveFor ignores the OS value, so a system flip
 *  is simply a no-op rather than something to subscribe/unsubscribe around. */
let initialized = false
export function initTheme(): void {
  if (initialized) return
  initialized = true
  // Re-assert the class the inline script should already have set — covers a
  // disabled-storage or exception path there.
  applyClass()
  window
    .matchMedia(DARK_QUERY)
    .addEventListener("change", () => sync(snapshot.pref))
}

/** Persist + apply a preference. Write failure (quota, disabled storage) is
 *  tolerated the same way ui-prefs tolerates it: the theme still switches for
 *  this session, it just won't survive a reload. */
export function setTheme(pref: ThemePref): void {
  writeJSON(THEME_KEY, pref)
  sync(pref)
}

export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribe, () => snapshot)
}
