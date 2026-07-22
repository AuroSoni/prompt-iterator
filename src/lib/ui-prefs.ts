// Persisted layout preferences: pane widths and visibility. Same module-store
// idiom as library.ts (module state + emit/subscribe + useSyncExternalStore),
// but for view-state only — one localStorage key, never the DB. Prefs are
// global: every open editor slot and the sidebar share them, so a drag in one
// slot updates all.

import { useSyncExternalStore } from "react"

import { readJSON, writeJSON } from "@/lib/local"

export interface UiPrefs {
  sidebarWidth: number
  outlineWidth: number
  inspectorWidth: number
  outlineVisible: boolean
  inspectorVisible: boolean
  sidebarCollapsed: boolean
  /** Library folder ids the user collapsed. Absent = expanded, so new folders
   *  render open. The sidebar prunes ids of deleted folders (see
   *  pruneCollapsedFolders); the sanitize cap bounds worst-case garbage. */
  collapsedFolders: string[]
}

/** Defaults mirror the pre-resize Tailwind widths (w-64 / w-52 / w-60), so a
 *  first render with no stored prefs is pixel-identical to the old layout. */
export const UI_LIMITS = {
  sidebarWidth: { min: 200, max: 420, def: 256 },
  outlineWidth: { min: 160, max: 400, def: 208 },
  inspectorWidth: { min: 200, max: 480, def: 240 },
} as const

const KEY = "pw:v1:ui"

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n))

/** Coerce anything (missing key, corrupt JSON, out-of-range widths from an
 *  older schema) into a valid UiPrefs — clamp, never throw. This is the whole
 *  migration story for this key. */
function sanitize(raw: unknown): UiPrefs {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >
  const num = (k: keyof typeof UI_LIMITS) => {
    const v = r[k]
    const { min, max, def } = UI_LIMITS[k]
    return typeof v === "number" && Number.isFinite(v)
      ? clamp(Math.round(v), min, max)
      : def
  }
  const bool = (k: string, def = true) =>
    typeof r[k] === "boolean" ? (r[k] as boolean) : def
  const collapsedFolders = Array.isArray(r.collapsedFolders)
    ? r.collapsedFolders
        .filter((x): x is string => typeof x === "string")
        .slice(0, 500)
    : []
  return {
    sidebarWidth: num("sidebarWidth"),
    outlineWidth: num("outlineWidth"),
    inspectorWidth: num("inspectorWidth"),
    outlineVisible: bool("outlineVisible"),
    inspectorVisible: bool("inspectorVisible"),
    // Panes default visible; the sidebar defaults expanded.
    sidebarCollapsed: bool("sidebarCollapsed", false),
    collapsedFolders,
  }
}

let prefs: UiPrefs = sanitize(readJSON(KEY))

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

/** Update prefs (values are sanitized/clamped). `persist: false` keeps the
 *  change in memory only — drag-move uses it so localStorage sees exactly one
 *  write per gesture, on the committing call. Write failure (quota, disabled
 *  storage) is tolerated: prefs are comfort state. */
export function setUiPrefs(
  patch: Partial<UiPrefs>,
  opts?: { persist?: boolean }
): void {
  const next = sanitize({ ...prefs, ...patch })
  const changed =
    next.sidebarWidth !== prefs.sidebarWidth ||
    next.outlineWidth !== prefs.outlineWidth ||
    next.inspectorWidth !== prefs.inspectorWidth ||
    next.outlineVisible !== prefs.outlineVisible ||
    next.inspectorVisible !== prefs.inspectorVisible ||
    next.sidebarCollapsed !== prefs.sidebarCollapsed ||
    // sanitize always allocates a fresh array — compare contents, not identity.
    next.collapsedFolders.length !== prefs.collapsedFolders.length ||
    next.collapsedFolders.some((v, i) => v !== prefs.collapsedFolders[i])
  if (changed) prefs = next
  if (opts?.persist !== false) writeJSON(KEY, prefs)
  if (changed) emit()
}

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(subscribe, () => prefs)
}

/** Collapse/expand one library folder. */
export function toggleFolderCollapsed(id: string): void {
  const cur = prefs.collapsedFolders
  setUiPrefs({
    collapsedFolders: cur.includes(id)
      ? cur.filter((x) => x !== id)
      : [...cur, id],
  })
}

/** Drop ids of folders that no longer exist (deleted here or out-of-band).
 *  The sidebar runs this whenever the folder list changes. */
export function pruneCollapsedFolders(live: ReadonlySet<string>): void {
  if (prefs.collapsedFolders.every((id) => live.has(id))) return
  setUiPrefs({
    collapsedFolders: prefs.collapsedFolders.filter((id) => live.has(id)),
  })
}
