// CodeMirror 6 state layer for the prompt editor: named regions painted over
// spans of continuous prose. Ported from the Phase-0 Cockpit prototype
// (cm-shared.js) — regions map through edits via tr.changes.mapPos, so text
// can be inserted or deleted around a region without breaking it.

import { StateEffect, StateField } from "@codemirror/state"
import type { EditorState, Extension, Range } from "@codemirror/state"
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
} from "@codemirror/view"
import type { DecorationSet, ViewUpdate } from "@codemirror/view"

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

export const regionsField = StateField.define<Region[]>({
  create: () => [],
  update(regions, tr) {
    let rs = regions
    if (tr.docChanged) {
      rs = rs
        .map((r) => ({
          ...r,
          from: tr.changes.mapPos(r.from, 1),
          to: tr.changes.mapPos(r.to, -1),
        }))
        .filter((r) => r.to > r.from)
    }
    for (const e of tr.effects) {
      if (e.is(addRegionEffect)) {
        rs = [...rs, e.value].sort((a, b) => a.from - b.from)
      }
      if (e.is(updateRegionEffect)) {
        const { id, patch } = e.value
        rs = rs.map((r) => (r.id === id ? { ...r, ...patch } : r))
      }
    }
    return rs
  },
})

/** Span tint per flag, carrying the region id for hit-testing. */
const regionMarks = EditorView.decorations.compute([regionsField], (state) => {
  const marks: Range<Decoration>[] = []
  for (const r of state.field(regionsField)) {
    if (r.to > r.from) {
      marks.push(
        Decoration.mark({
          class: `pi-region pi-flag-${r.flag}`,
          attributes: { "data-region-id": r.id },
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

// ---- Markdown-ish highlighting (no full language package needed) ---------

const mdDeco = new MatchDecorator({
  regexp: /(^#{1,3} .*$)|(\*\*[^*\n]+\*\*)|(\{\{[a-z_]+\}\})|(`[^`\n]+`)/g,
  decoration: (m) =>
    Decoration.mark({
      class: m[1]
        ? "pi-md-heading"
        : m[2]
          ? "pi-md-bold"
          : m[3]
            ? "pi-md-var"
            : "pi-md-code",
    }),
})

const markdownHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = mdDeco.createDeco(view)
    }
    update(u: ViewUpdate) {
      this.decorations = mdDeco.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations }
)

/** Everything region-related, seeded with a doc's stored regions. */
export function regionExtensions(initial: Region[]): Extension {
  return [
    regionsField.init(() => initial.map((r) => ({ ...r }))),
    regionMarks,
    regionStartLines,
    markdownHighlight,
  ]
}

// ---- Helpers -------------------------------------------------------------

export function regionAt(state: EditorState, pos: number): Region | null {
  return (
    state.field(regionsField).find((r) => pos >= r.from && pos <= r.to) ?? null
  )
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

/** Structure-ribbon math: full doc coverage as segments (regions + gaps). */
export interface RibbonSegment {
  region: Region | null
  from: number
  to: number
  pct: number
}

export function ribbonSegments(state: EditorState): RibbonSegment[] {
  const len = Math.max(1, state.doc.length)
  const segs: RibbonSegment[] = []
  let cursor = 0
  for (const r of state.field(regionsField)) {
    if (r.from > cursor) segs.push({ region: null, from: cursor, to: r.from, pct: 0 })
    segs.push({ region: r, from: r.from, to: r.to, pct: 0 })
    cursor = Math.max(cursor, r.to)
  }
  if (cursor < len) segs.push({ region: null, from: cursor, to: len, pct: 0 })
  for (const s of segs) s.pct = ((s.to - s.from) / len) * 100
  return segs
}
