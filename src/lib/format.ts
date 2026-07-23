// Structural auto-format for prompt docs (Shift+Alt+F). A pure, fence-aware,
// jinja-safe, region-safe tidy: it only edits whitespace and never joins or
// splits a line, so single-line {{jinja}} / {% %} / {# #} are untouched and
// every regionsField span maps cleanly through the changes. Emitted as a
// MINIMAL, DISJOINT ChangeSet — never a whole-doc replace, which would collapse
// every region boundary to a single point.
//
// The four rules are designed to never overlap: (A) trims trailing whitespace on
// non-blank lines only; (B) collapses interior blank runs (deletes blank lines);
// (C) inserts a blank line at non-blank boundaries; (D) normalizes the EOF tail.
// A only touches non-blank lines, B/D only delete blank lines, C only inserts at
// non-blank boundaries — so no two rules ever address the same span.

import type { ChangeSet, ChangeSpec, EditorState } from "@codemirror/state"
import type { Command, KeyBinding } from "@codemirror/view"

import { FENCE } from "@/lib/fold"
import { outlineNodes } from "@/lib/outline"
import type { OutlineNode } from "@/lib/outline"

const TRAILING = /[ \t]+$/

/** Lines (1-indexed) that must not be touched: fence delimiters and everything
 *  inside a fenced block (its indentation/whitespace is content). */
function protectedLines(state: EditorState): boolean[] {
  const prot = new Array<boolean>(state.doc.lines + 1).fill(false)
  let inFence = false
  for (let i = 1; i <= state.doc.lines; i++) {
    if (FENCE.test(state.doc.line(i).text)) {
      prot[i] = true
      inFence = !inFence
    } else if (inFence) {
      prot[i] = true
    }
  }
  return prot
}

const isBlank = (state: EditorState, i: number) =>
  state.doc.line(i).text.trim().length === 0

/** Compute the structural-format changes, or null when the doc is already
 *  clean (so the command can no-op without touching history). */
export function formatDoc(state: EditorState): ChangeSet | null {
  const { doc } = state
  const prot = protectedLines(state)
  const changes: ChangeSpec[] = []

  // (A) Trim trailing whitespace on non-blank, unprotected lines. Blank-line
  // whitespace is owned by (B)/(D) (or harmlessly left) — trimming it here could
  // overlap their deletions.
  for (let i = 1; i <= doc.lines; i++) {
    if (prot[i]) continue
    const line = doc.line(i)
    if (line.text.trim().length === 0) continue
    const m = TRAILING.exec(line.text)
    if (m) changes.push({ from: line.from + m.index, to: line.to })
  }

  // (B) Collapse 3+ consecutive interior blank lines to one (keep the first,
  // delete the rest). The EOF-touching run is left to (D), which strips it.
  let runStart = 0
  for (let i = 1; i <= doc.lines + 1; i++) {
    const blank = i <= doc.lines && !prot[i] && isBlank(state, i)
    if (blank) {
      if (runStart === 0) runStart = i
    } else if (runStart > 0) {
      const runEnd = i - 1
      if (runEnd < doc.lines && runEnd - runStart + 1 >= 3) {
        changes.push({ from: doc.line(runStart).to, to: doc.line(runEnd).to })
      }
      runStart = 0
    }
  }

  // (C) One blank line before every heading and around every top-level tag.
  // Insert positions are deduped so two rules wanting the same boundary add one.
  const inserts = new Set<number>()
  const blankBefore = (lineNo: number) => {
    if (lineNo > 1 && !isBlank(state, lineNo - 1)) inserts.add(doc.line(lineNo).from)
  }
  const blankAfter = (lineNo: number) => {
    if (lineNo < doc.lines && !isBlank(state, lineNo + 1)) {
      inserts.add(doc.line(lineNo + 1).from)
    }
  }
  const visitHeadings = (nodes: OutlineNode[]) => {
    for (const n of nodes) {
      if (n.kind === "heading") blankBefore(doc.lineAt(n.from).number)
      visitHeadings(n.children)
    }
  }
  const roots = outlineNodes(doc)
  visitHeadings(roots)
  for (const n of roots) {
    if (n.kind === "tag") {
      blankBefore(doc.lineAt(n.from).number)
      blankAfter(doc.lineAt(n.to).number)
    }
  }
  for (const pos of inserts) changes.push({ from: pos, insert: "\n" })

  // (D) Exactly one final newline; strip trailing blank lines.
  let p = doc.length
  while (p > 0 && doc.sliceString(p - 1, p) === "\n") p--
  const trailing = doc.length - p
  if (trailing === 0) changes.push({ from: doc.length, insert: "\n" })
  else if (trailing > 1) changes.push({ from: p + 1, to: doc.length })

  if (changes.length === 0) return null
  return state.changes(changes)
}

/** Shift+Alt+F. No-op (returns false) on read-only docs so it never writes. */
export const formatCommand: Command = (view) => {
  if (view.state.readOnly) return false
  const changes = formatDoc(view.state)
  if (!changes || changes.empty) return true
  view.dispatch({ changes, userEvent: "format" })
  return true
}

export const formatKeymap: KeyBinding[] = [{ key: "Shift-Alt-f", run: formatCommand }]
