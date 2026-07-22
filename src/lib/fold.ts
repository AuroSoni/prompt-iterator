// Folding for mixed prompt content. lang-markdown already folds heading
// sections, fenced code, blockquotes and (via lang-json nesting) json fences —
// this module adds the two things commonmark cannot see, because HTML blocks
// end at the first blank line: multi-paragraph <tag>…</tag> pairs, and raw
// {…}/[…] blocks outside fences. Fold state is view-state: persisted to
// localStorage per doc, never to the DB.

import {
  codeFolding,
  foldEffect,
  foldedRanges,
  foldService,
  unfoldEffect,
} from "@codemirror/language"
import type { EditorState, Extension, StateEffect, Text } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

import { readJSON, removeKey, writeJSON } from "@/lib/local"

// ---- Custom fold ranges: XML pairs + brace blocks ------------------------

// foldService is queried per visible line on every gutter refresh, so ranges
// are indexed once per document version (keyed by the immutable Text) and each
// query is a Map lookup. One O(doc) pass at prompt scale is sub-millisecond;
// genuinely huge docs skip indexing rather than stall.
const MAX_INDEX_LINES = 50_000

const foldIndexCache = new WeakMap<Text, Map<number, number>>()

// Shared with the content outline (@/lib/outline) — one notion of "a tag".
export const OPEN_TAG = /^<([A-Za-z][\w.-]*)(?:\s[^<>]*)?>/
export const CLOSE_TAG = /^<\/([A-Za-z][\w.-]*)\s*>/
export const SELF_CLOSING = /^<[A-Za-z][\w.-]*(?:\s[^<>]*)?\/>/
export const FENCE = /^\s*(```|~~~)/

interface OpenFrame {
  name: string // tag name, or "{" / "[" for brace frames
  lineFrom: number
  lineTo: number
}

function buildFoldIndex(doc: Text): Map<number, number> {
  const index = new Map<number, number>()
  if (doc.lines > MAX_INDEX_LINES) return index

  const tagStack: OpenFrame[] = []
  const braceStack: OpenFrame[] = []
  let inFence = false

  const record = (frame: OpenFrame, closeLineFrom: number) => {
    // Fold from the end of the opening line to just before the closing line,
    // so the closing </tag> / } stays visible. Multi-line pairs only.
    const to = closeLineFrom - 1
    if (to <= frame.lineTo) return
    const prev = index.get(frame.lineFrom)
    if (prev === undefined || to > prev) index.set(frame.lineFrom, to)
  }

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const text = line.text.trim()

    // Fenced code toggles; lezer owns folding (and content) inside fences.
    if (FENCE.test(line.text)) {
      inFence = !inFence
      continue
    }
    if (inFence || text.length === 0) continue

    // Closing tag first (a line can't be both in our line-anchored model).
    const close = CLOSE_TAG.exec(text)
    if (close) {
      // Tolerant unwind: match the nearest open frame with this name; frames
      // above it are ragged/unclosed and produce no fold (a missing fold beats
      // a wrong fold). A stray close with no match is ignored.
      for (let i = tagStack.length - 1; i >= 0; i--) {
        if (tagStack[i].name === close[1]) {
          record(tagStack[i], line.from)
          tagStack.length = i
          break
        }
      }
      continue
    }
    if (!SELF_CLOSING.test(text)) {
      const open = OPEN_TAG.exec(text)
      // An element opened and closed on the same line is not foldable.
      if (open && !text.includes(`</${open[1]}>`)) {
        tagStack.push({ name: open[1], lineFrom: line.from, lineTo: line.to })
        continue
      }
    }

    // Brace/bracket blocks: a line ending in an opener, closed by a line
    // starting with the matching closer (trailing commas tolerated).
    const last = text[text.length - 1]
    const first = text[0]
    if (first === "}" || first === "]") {
      const want = first === "}" ? "{" : "["
      const top = braceStack[braceStack.length - 1]
      if (top && top.name === want) {
        record(top, line.from)
        braceStack.pop()
      }
      // Mismatched closer: ignore — ragged JSON folds nothing.
    }
    if (last === "{" || last === "[") {
      braceStack.push({ name: last, lineFrom: line.from, lineTo: line.to })
    }
  }
  return index
}

function foldIndex(doc: Text): Map<number, number> {
  let index = foldIndexCache.get(doc)
  if (!index) {
    index = buildFoldIndex(doc)
    foldIndexCache.set(doc, index)
  }
  return index
}

function xmlBraceFold(
  state: EditorState,
  lineStart: number,
  lineEnd: number
): { from: number; to: number } | null {
  const to = foldIndex(state.doc).get(lineStart)
  return to !== undefined && to > lineEnd ? { from: lineEnd, to } : null
}

/** Fold support for prompt docs. Always-on (NOT in the mode compartment):
 *  codeFolding() owns the fold state, so parking it in the compartment would
 *  silently unfold everything on entering zen. Only the gutter is mode-local. */
export function promptFolding(): Extension {
  return [
    codeFolding({ placeholderText: "…" }),
    foldService.of(xmlBraceFold),
  ]
}

// ---- Reveal (unfold + navigate) ------------------------------------------

/** Unfold every folded range containing `pos`. No-op when none do. */
export function unfoldAt(view: EditorView, pos: number): void {
  const effects: StateEffect<{ from: number; to: number }>[] = []
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    if (pos >= from && pos <= to) effects.push(unfoldEffect.of({ from, to }))
  })
  if (effects.length > 0) view.dispatch({ effects })
}

/** Navigate to a position that may be hidden inside folds: unfold, then
 *  center it. Used by the outline; region jumps compose unfoldAt with
 *  scrollToRegion instead (regions want the start-anchored scroll). */
export function revealPos(view: EditorView, pos: number): void {
  unfoldAt(view, pos)
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  })
  view.focus()
}

// ---- Fold persistence (localStorage, view-state only) --------------------

interface StoredFolds {
  /** Doc length at save time — the staleness guard. If the body changed since
   *  (other device, DB edit), offsets are meaningless and the entry is dropped. */
  len: number
  ranges: [number, number][]
}

const foldKey = (docId: string) => `pw:v1:fold:${docId}`

export function saveFolds(docId: string, state: EditorState): void {
  const ranges: [number, number][] = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    ranges.push([from, to])
  })
  if (ranges.length === 0) {
    removeKey(foldKey(docId))
  } else {
    writeJSON(foldKey(docId), { len: state.doc.length, ranges })
  }
}

export function restoreFolds(view: EditorView, docId: string): void {
  const stored = readJSON<StoredFolds>(foldKey(docId))
  if (!stored || !Array.isArray(stored.ranges)) return
  const len = view.state.doc.length
  if (stored.len !== len) {
    // Body changed since the folds were saved — offsets are stale.
    removeKey(foldKey(docId))
    return
  }
  // StrictMode double-mount guard: the second mount sees the survivor view
  // already folded — dispatching again would stack duplicate fold marks.
  if (foldedRanges(view.state).size > 0) return
  const effects = stored.ranges
    .filter(
      (r): r is [number, number] =>
        Array.isArray(r) && r.length === 2 && r[0] >= 0 && r[0] < r[1] && r[1] <= len
    )
    .map(([from, to]) => foldEffect.of({ from, to }))
  if (effects.length > 0) view.dispatch({ effects })
}
