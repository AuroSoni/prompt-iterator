// CodeMirror 6 state layer for the prompt editor: named regions painted over
// spans of continuous prose. Ported from the Phase-0 Cockpit prototype
// (cm-shared.js) — regions map through edits via tr.changes.mapPos, so text
// can be inserted or deleted around a region without breaking it.

import { StateEffect, StateField } from "@codemirror/state"
import type { EditorState, Extension, Range } from "@codemirror/state"
import { Decoration, EditorView } from "@codemirror/view"

export type Flag = "ok" | "suspect" | "stale" | "revisit"

export const FLAGS: Flag[] = ["ok", "suspect", "stale", "revisit"]

/** A named, annotated span of the prompt. Regions may be ragged and text can
 *  exist outside any region — they are an overlay, not a partition. */
export interface Region {
  id: string
  name: string
  flag: Flag
  note: string
  from: number
  to: number
  /** Unification ("all regions are snippets"): when set, this region is an
   *  occurrence of a library snippet — its text was copied from that snippet and
   *  it can pull/push updates. Absent = a plain local annotation (legacy). */
  snippetId?: string
  /** The snippet `version` this region's text was last synced to. Drives the
   *  staleness signal: syncedVersion < snippet.version ⇒ update available. */
  syncedVersion?: number
}

/** Crude but stable token estimate (chars / 4) — a legibility cue, not billing. */
export function approxTokens(s: string): number {
  return Math.max(1, Math.round(s.length / 4))
}

// ---- Regions state -------------------------------------------------------

export const addRegionEffect = StateEffect.define<Region>()
export const updateRegionEffect = StateEffect.define<{
  id: string
  patch: Partial<Region>
}>()
/** Remove a region annotation by id. The underlying text is left untouched —
 *  regions are an overlay, not a partition. */
export const removeRegionEffect = StateEffect.define<string>()

export const regionsField = StateField.define<Region[]>({
  create: () => [],
  update(regions, tr) {
    let rs = regions
    let changed = false
    if (tr.docChanged) {
      rs = rs.map((r) => ({
        ...r,
        from: tr.changes.mapPos(r.from, 1),
        to: tr.changes.mapPos(r.to, -1),
      }))
      changed = true
    }
    for (const e of tr.effects) {
      if (e.is(addRegionEffect)) {
        rs = [...rs, e.value].sort((a, b) => a.from - b.from)
        changed = true
      }
      if (e.is(updateRegionEffect)) {
        const { id, patch } = e.value
        rs = rs.map((r) => (r.id === id ? { ...r, ...patch } : r))
        changed = true
      }
      if (e.is(removeRegionEffect)) {
        rs = rs.filter((r) => r.id !== e.value)
        changed = true
      }
    }
    // Drop zero-length regions AFTER applying effects, not inside the docChanged
    // branch: a "pull" replaces a region's exact span (collapsing it to zero
    // under mapPos) AND restores its bounds via an updateRegionEffect in the SAME
    // transaction — filtering before effects would delete it first. Adds are
    // guarded against zero-length by the caller (markSelection / insert). Only
    // rebuild when something changed, to keep the field reference stable on
    // plain selection/scroll transactions.
    return changed ? rs.filter((r) => r.to > r.from) : rs
  },
})

/** Span tint per flag, carrying the region id for hit-testing. */
const regionMarks = EditorView.decorations.compute([regionsField], (state) => {
  const marks: Range<Decoration>[] = []
  for (const r of state.field(regionsField)) {
    if (r.to > r.from) {
      marks.push(
        Decoration.mark({
          class: `pi-region pi-flag-${r.flag}${r.snippetId ? " pi-region-linked" : ""}`,
          attributes: r.snippetId
            ? { "data-region-id": r.id, "data-snippet-id": r.snippetId }
            : { "data-region-id": r.id },
        }).range(r.from, r.to)
      )
    }
  }
  return Decoration.set(marks, true)
})

/** Region name tag above each region's first line (rendered via CSS ::before). */
const regionStartLines = EditorView.decorations.compute(
  [regionsField],
  (state) => {
    const lines: Range<Decoration>[] = []
    const seen = new Set<number>()
    for (const r of state.field(regionsField)) {
      const line = state.doc.lineAt(Math.min(r.from, state.doc.length))
      if (seen.has(line.from)) continue
      seen.add(line.from)
      lines.push(
        Decoration.line({
          class: `pi-region-startline pi-startline-${r.flag}`,
          attributes: { "data-rname": r.name },
        }).range(line.from)
      )
    }
    return Decoration.set(
      lines.sort((a, b) => a.from - b.from),
      true
    )
  }
)

/** Everything region-related, seeded with a doc's stored regions. Syntax
 *  highlighting lives in @/lib/language (grammar-based) — not here. */
export function regionExtensions(initial: Region[]): Extension {
  return [
    regionsField.init(() => initial.map((r) => ({ ...r }))),
    regionMarks,
    regionStartLines,
  ]
}

// ---- Helpers -------------------------------------------------------------

export function regionAt(state: EditorState, pos: number): Region | null {
  return (
    state.field(regionsField).find((r) => pos >= r.from && pos <= r.to) ?? null
  )
}

/** True if [from,to) overlaps any existing region. A mark that overlaps would
 *  make "which snippet owns this text" ambiguous once regions carry snippet
 *  identity, so marking guards against it. */
export function regionsOverlap(
  regions: Region[],
  from: number,
  to: number
): boolean {
  return regions.some((r) => from < r.to && to > r.from)
}

// ---- Active-view registry ------------------------------------------------
// Bridges the sidebar / App (which only know doc ids) to the live EditorView of
// an open doc, so a snippet can be inserted — or a region pulled — into the doc
// the user is looking at. PromptEditor (un)registers on mount/destroy; each doc
// opens in at most one slot, so a docId maps to ≤1 view.

const editorViews = new Map<string, EditorView>()

export function registerView(docId: string, view: EditorView): void {
  editorViews.set(docId, view)
}

/** Unregister only if `view` is still the registered one, so a StrictMode
 *  remount's cleanup can't delete the newly-registered view. */
export function unregisterView(docId: string, view: EditorView): void {
  if (editorViews.get(docId) === view) editorViews.delete(docId)
}

export function getView(docId: string): EditorView | undefined {
  return editorViews.get(docId)
}

export function scrollToRegion(view: EditorView, r: Region): void {
  view.dispatch({
    selection: { anchor: r.from },
    effects: EditorView.scrollIntoView(r.from, { y: "start", yMargin: 60 }),
  })
  view.focus()
}

/** A region plus the derived numbers the chrome renders. */
export interface RegionInfo extends Region {
  tokens: number
  pct: number
}

export function regionInfos(state: EditorState): RegionInfo[] {
  const len = Math.max(1, state.doc.length)
  return state.field(regionsField).map((r) => ({
    ...r,
    tokens: approxTokens(state.doc.sliceString(r.from, r.to)),
    pct: Math.round(((r.to - r.from) / len) * 100),
  }))
}

/** Structure-ribbon math: one marker per region, positioned by VISUAL block
 *  geometry (not character proportion) so folds are respected. Percentages are
 *  in the scroller's scroll space — the same basis the viewport indicator uses
 *  (scrollTop/scrollHeight) — so markers and viewport can never diverge again.
 *  A region inside a folded range collapses to its fold line's block; the
 *  renderer applies a px floor to keep it visible. */
export interface RibbonMark {
  region: Region
  topPct: number
  heightPct: number
}

export function ribbonMarks(view: EditorView): RibbonMark[] {
  const scrollHeight = view.scrollDOM.scrollHeight || 1
  // lineBlockAt tops are relative to the first line; scroll space starts above
  // the document padding. Offsetting by padding keeps the shared basis exact.
  const pad = view.documentPadding.top
  const len = view.state.doc.length
  return view.state.field(regionsField).map((r) => {
    const top = view.lineBlockAt(Math.min(r.from, len)).top
    const bottom = view.lineBlockAt(Math.min(r.to, len)).bottom
    return {
      region: r,
      topPct: ((pad + top) / scrollHeight) * 100,
      heightPct: (Math.max(0, bottom - top) / scrollHeight) * 100,
    }
  })
}
