// VS Code-style fold power-commands, layered on the folding stack in fold.ts.
// Every fold derives its range from foldable() on a node's opening line — the
// exact query the fold gutter and the Ctrl+Shift+[ chord already use — so a
// programmatic fold is identical to a gutter-click fold. Nesting comes from the
// content outline (@/lib/outline), which already computes one containment tree
// of headings + XML tags. These are pure Commands (view-state only, no doc
// edit), so they also work on read-only version docs.

import {
  foldAll,
  foldCode,
  foldEffect,
  foldable,
  foldedRanges,
  toggleFold,
  unfoldAll,
  unfoldCode,
} from "@codemirror/language"
import type { EditorState } from "@codemirror/state"
import type { Command, EditorView, KeyBinding } from "@codemirror/view"

import { unfoldAt } from "@/lib/fold"
import { outlineNodeAt, outlineNodes } from "@/lib/outline"
import type { OutlineNode } from "@/lib/outline"

interface FoldRange {
  from: number
  to: number
}

/** The canonical fold range for a node's opening line, or null when that line
 *  isn't independently foldable (single-line tag, empty-body heading). */
function foldRangeFor(state: EditorState, node: OutlineNode): FoldRange | null {
  const line = state.doc.lineAt(node.from)
  return foldable(state, line.from, line.to)
}

function walk(nodes: OutlineNode[], visit: (n: OutlineNode) => void): void {
  for (const n of nodes) {
    visit(n)
    walk(n.children, visit)
  }
}

function currentFolds(state: EditorState): FoldRange[] {
  const out: FoldRange[] = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    out.push({ from, to })
  })
  return out
}

/** Fold every range not already covered by an existing fold (avoids stacking
 *  duplicate fold marks). Always returns true — the chord is consumed even when
 *  there's nothing to fold, matching VS Code. */
function applyFolds(view: EditorView, ranges: FoldRange[]): boolean {
  const folds = currentFolds(view.state)
  const effects = ranges
    .filter((r) => !folds.some((f) => f.from <= r.from && f.to >= r.to))
    .map((r) => foldEffect.of(r))
  if (effects.length > 0) view.dispatch({ effects })
  return true
}

/** Fold the outline node at the caret plus all its descendants. */
export const foldRecursively: Command = (view) => {
  const node = outlineNodeAt(
    outlineNodes(view.state.doc),
    view.state.selection.main.head
  )
  if (!node) return foldCode(view)
  const targets: FoldRange[] = []
  walk([node], (n) => {
    const r = foldRangeFor(view.state, n)
    if (r) targets.push(r)
  })
  return applyFolds(view, targets)
}

/** Unfold the outline node at the caret plus all its descendants. */
export const unfoldRecursively: Command = (view) => {
  const node = outlineNodeAt(
    outlineNodes(view.state.doc),
    view.state.selection.main.head
  )
  if (!node) return unfoldCode(view)
  unfoldAt(view, node.from, node.to)
  return true
}

/** Fold every outline node at tree-depth `level` (roots = depth 1). Folding a
 *  depth-`level` node hides everything nested under it, so shallower levels stay
 *  open — VS Code "Fold Level N". */
export function foldToLevel(level: number): Command {
  return (view) => {
    const targets: FoldRange[] = []
    const collect = (nodes: OutlineNode[], depth: number) => {
      for (const node of nodes) {
        if (depth >= level) {
          const r = foldRangeFor(view.state, node)
          if (r) targets.push(r)
        } else {
          collect(node.children, depth + 1)
        }
      }
    }
    collect(outlineNodes(view.state.doc), 1)
    unfoldAll(view)
    return applyFolds(view, targets)
  }
}

function foldByKind(kind: OutlineNode["kind"]): Command {
  return (view) => {
    const targets: FoldRange[] = []
    walk(outlineNodes(view.state.doc), (n) => {
      if (n.kind === kind) {
        const r = foldRangeFor(view.state, n)
        if (r) targets.push(r)
      }
    })
    return applyFolds(view, targets)
  }
}

/** Fold every multi-line XML `<tag>…</tag>` element. */
export const foldAllTags = foldByKind("tag")
/** Fold every markdown heading section. */
export const foldAllHeadings = foldByKind("heading")

/** Fold everything except the caret's section — its ancestor chain stays open,
 *  every sibling collapses. VS Code "Fold All Except Selected". */
export const foldAllExceptCurrent: Command = (view) => {
  const caret = view.state.selection.main.head
  const targets: FoldRange[] = []
  const recurse = (nodes: OutlineNode[]) => {
    for (const n of nodes) {
      if (caret >= n.from && caret <= n.to) {
        recurse(n.children) // on the caret's path: keep open, descend
      } else {
        const r = foldRangeFor(view.state, n)
        if (r) targets.push(r)
      }
    }
  }
  recurse(outlineNodes(view.state.doc))
  return applyFolds(view, targets)
}

// VS Code's Ctrl+K chords. Ctrl+K alone is unbound in this app, so the chords
// are unambiguous; `Mod` maps to Ctrl/Cmd. (VS Code's Fold-All-Except is
// Ctrl+K Ctrl+-, but `-` is CodeMirror's key separator — bound to `e` = except.)
export const foldChordKeymap: KeyBinding[] = [
  { key: "Mod-k Mod-0", run: foldAll },
  { key: "Mod-k Mod-j", run: unfoldAll },
  { key: "Mod-k Mod-[", run: foldRecursively },
  { key: "Mod-k Mod-]", run: unfoldRecursively },
  { key: "Mod-k Mod-l", run: toggleFold },
  { key: "Mod-k Mod-1", run: foldToLevel(1) },
  { key: "Mod-k Mod-2", run: foldToLevel(2) },
  { key: "Mod-k Mod-3", run: foldToLevel(3) },
  { key: "Mod-k Mod-4", run: foldToLevel(4) },
  { key: "Mod-k Mod-5", run: foldToLevel(5) },
  { key: "Mod-k Mod-6", run: foldToLevel(6) },
  { key: "Mod-k Mod-t", run: foldAllTags },
  { key: "Mod-k Mod-h", run: foldAllHeadings },
  { key: "Mod-k Mod-e", run: foldAllExceptCurrent },
]
