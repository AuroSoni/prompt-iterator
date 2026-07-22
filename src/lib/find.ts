// Find & replace engine for the prompt editor: a StateField of current matches
// (painted + mapped through edits, like regionsField) plus pure query/replace
// helpers the React FindBar drives. Ported from the Phase-0 design-shotgun
// prototype (variant A · Bar). No @codemirror/search dependency — the matcher
// is plain-JS RegExp over the doc string, matching this codebase's hand-rolled
// decoration idiom.

import { StateEffect, StateField } from "@codemirror/state"
import type { EditorState, Extension, Range } from "@codemirror/state"
import { Decoration, EditorView } from "@codemirror/view"

import { regionsField } from "@/lib/editor"

export interface FindOpts {
  caseSense: boolean
  word: boolean
  regex: boolean
}

export interface FindMatch {
  from: number
  to: number
  text: string
  /** Replacement text for this match; set only during a replace op. */
  repl?: string
}

/** Cap total matches so a catastrophic query (e.g. `.` on a big doc) can't
 *  allocate unbounded — 5000 is far beyond any real prompt's occurrence count. */
const MATCH_CAP = 5000

// ---- Query compilation ---------------------------------------------------

/** Escape a literal string for use inside a RegExp. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Compile the query per the toggles. `re: null` = empty query (clear);
 *  `error` = invalid regex (the caller shows it and paints nothing). */
export function buildQuery(
  query: string,
  opts: FindOpts
): { re: RegExp | null; error?: string } {
  if (!query) return { re: null }
  let src = opts.regex ? query : escapeRe(query)
  if (opts.word) src = `\\b(?:${src})\\b`
  try {
    return { re: new RegExp(src, opts.caseSense ? "gm" : "gim") }
  } catch (e) {
    return { re: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** All non-overlapping matches of `re` in `docString`. Zero-length matches are
 *  skipped (advancing lastIndex) so an empty-width regex can't spin. */
export function findMatches(
  docString: string,
  re: RegExp,
  cap: number = MATCH_CAP
): FindMatch[] {
  const out: FindMatch[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(docString))) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    out.push({ from: m.index, to: m.index + m[0].length, text: m[0] })
    if (out.length >= cap) break
  }
  return out
}

/** A non-global clone of `re`, so `String.replace` applies to the single match
 *  text (and honours $1 group refs) rather than scanning globally. */
function nonGlobal(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.replace(/g/g, ""))
}

/** The replacement for one match's text, supporting `$1` group refs in regex
 *  mode. Falls back to the raw replacement if the sub throws. */
export function replFor(
  matchText: string,
  re: RegExp,
  replacement: string
): string {
  try {
    return matchText.replace(nonGlobal(re), replacement)
  } catch {
    return replacement
  }
}

// ---- Find state field ----------------------------------------------------

export interface FindData {
  matches: FindMatch[]
  /** Index into `matches` of the highlighted "current" match, or -1. */
  current: number
}

export const setFindEffect = StateEffect.define<FindData>()

export const findField = StateField.define<FindData>({
  create: () => ({ matches: [], current: -1 }),
  update(value, tr) {
    let v = value
    // Map existing matches through edits so highlights track the text until the
    // FindBar re-runs the search (same map-through-edits idea as regionsField).
    if (tr.docChanged && v.matches.length) {
      const mapped = v.matches
        .map((mtch) => ({
          ...mtch,
          from: tr.changes.mapPos(mtch.from, 1),
          to: tr.changes.mapPos(mtch.to, -1),
        }))
        .filter((mtch) => mtch.to > mtch.from)
      v = { matches: mapped, current: Math.min(v.current, mapped.length - 1) }
    }
    for (const e of tr.effects) if (e.is(setFindEffect)) v = e.value
    return v
  },
})

const findMarks = EditorView.decorations.compute([findField], (state) => {
  const { matches, current } = state.field(findField)
  const ranges: Range<Decoration>[] = []
  matches.forEach((mtch, i) => {
    if (mtch.to > mtch.from) {
      ranges.push(
        Decoration.mark({
          class: i === current ? "pi-find-match pi-find-current" : "pi-find-match",
        }).range(mtch.from, mtch.to)
      )
    }
  })
  return Decoration.set(ranges, true)
})

export function findExtension(): Extension {
  return [findField, findMarks]
}

// ---- Imperative helpers (the FindBar dispatches these) -------------------

export function setFind(
  view: EditorView,
  matches: FindMatch[],
  current: number
): void {
  view.dispatch({ effects: setFindEffect.of({ matches, current }) })
}

export function clearFind(view: EditorView): void {
  view.dispatch({ effects: setFindEffect.of({ matches: [], current: -1 }) })
}

/** Highlight match `idx` (wrapping) and scroll it into view. Returns the
 *  normalized index, or -1 when there are no matches. */
export function gotoMatch(
  view: EditorView,
  matches: FindMatch[],
  idx: number
): number {
  if (!matches.length) return -1
  const i = ((idx % matches.length) + matches.length) % matches.length
  view.dispatch({
    effects: [
      setFindEffect.of({ matches, current: i }),
      EditorView.scrollIntoView(matches[i].from, { y: "center" }),
    ],
  })
  return i
}

/** Apply a batch of replacements as ONE transaction (one undo step). Regions
 *  map through the edit via regionsField; a replace inside a linked region
 *  surfaces as "local edits" in the Inspector with no drift-specific code. */
export function replaceRanges(view: EditorView, ranges: FindMatch[]): number {
  if (!ranges.length) return 0
  view.dispatch({
    changes: ranges.map((r) => ({ from: r.from, to: r.to, insert: r.repl ?? "" })),
    userEvent: "input.replace",
  })
  return ranges.length
}

/** How many matches overlap a region that is linked to a library snippet.
 *  Informational only (the replace heads-up); reads regionsField, mutates
 *  nothing. */
export function linkedMatchCount(
  state: EditorState,
  matches: FindMatch[]
): number {
  const linked = state.field(regionsField).filter((r) => r.snippetId)
  if (!linked.length) return 0
  return matches.filter((m) =>
    linked.some((r) => m.from < r.to && m.to > r.from)
  ).length
}
