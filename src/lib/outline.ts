// Content-structure outline for mixed prompt docs: markdown ATX headings and
// XML tag pairs merged into ONE containment tree, so the Outline pane shows
// the prompt's shape at a glance. Same indexing discipline as fold.ts: one
// O(doc) line pass, cached per immutable Text, fence-aware, and tolerant of
// ragged tags (a missing node beats a wrong node).

import type { Text } from "@codemirror/state"

import { CLOSE_TAG, FENCE, OPEN_TAG, SELF_CLOSING } from "@/lib/fold"

export interface OutlineNode {
  kind: "heading" | "tag"
  /** Heading text, or the bare tag name. */
  label: string
  /** Heading level 1-6; 0 for tags (their nesting is the tree itself). */
  level: number
  from: number
  to: number
  children: OutlineNode[]
}

const MAX_INDEX_LINES = 50_000

// ATX only (like lang-markdown's folding); optional closing hashes stripped.
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/

const outlineCache = new WeakMap<Text, OutlineNode[]>()

export function outlineNodes(doc: Text): OutlineNode[] {
  let nodes = outlineCache.get(doc)
  if (!nodes) {
    nodes = buildOutline(doc)
    outlineCache.set(doc, nodes)
  }
  return nodes
}

/** Deepest node containing `pos` — the caret-highlight target. */
export function outlineNodeAt(
  nodes: OutlineNode[],
  pos: number
): OutlineNode | null {
  for (const n of nodes) {
    if (pos >= n.from && pos <= n.to) {
      return outlineNodeAt(n.children, pos) ?? n
    }
  }
  return null
}

function buildOutline(doc: Text): OutlineNode[] {
  const roots: OutlineNode[] = []
  if (doc.lines > MAX_INDEX_LINES) return roots

  // The stack holds OPEN containers; nodes join the tree at open time, so a
  // tag left unclosed still appears (bounded at doc end).
  const stack: OutlineNode[] = []
  let inFence = false

  const childrenOf = () =>
    stack.length > 0 ? stack[stack.length - 1].children : roots
  const closeDownTo = (depth: number, endPos: number) => {
    while (stack.length > depth) {
      const n = stack.pop()!
      n.to = Math.max(n.from, endPos)
    }
  }
  const leaf = (kind: OutlineNode["kind"], label: string, from: number, to: number) =>
    childrenOf().push({ kind, label, level: 0, from, to, children: [] })

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const text = line.text.trim()

    // Fenced code toggles; nothing inside a fence is prompt structure.
    if (FENCE.test(line.text)) {
      inFence = !inFence
      continue
    }
    if (inFence || text.length === 0) continue

    const close = CLOSE_TAG.exec(text)
    if (close) {
      // Tolerant unwind: match the nearest open tag with this name. Frames
      // above it (headings, ragged inner tags) end just before this line; a
      // stray close with no match changes nothing.
      for (let s = stack.length - 1; s >= 0; s--) {
        const n = stack[s]
        if (n.kind === "tag" && n.label === close[1]) {
          closeDownTo(s + 1, Math.max(0, line.from - 1))
          stack.pop()
          n.to = line.to
          break
        }
      }
      continue
    }

    if (SELF_CLOSING.test(text)) {
      const m = /^<([A-Za-z][\w.-]*)/.exec(text)
      if (m) leaf("tag", m[1], line.from, line.to)
      continue
    }

    const open = OPEN_TAG.exec(text)
    if (open) {
      if (text.includes(`</${open[1]}>`)) {
        // Opened and closed on one line: structure, but a leaf.
        leaf("tag", open[1], line.from, line.to)
      } else {
        const node: OutlineNode = {
          kind: "tag",
          label: open[1],
          level: 0,
          from: line.from,
          to: line.to,
          children: [],
        }
        childrenOf().push(node)
        stack.push(node)
      }
      continue
    }

    const h = HEADING.exec(text)
    if (h) {
      const level = h[1].length
      // A heading closes open headings of same-or-higher level — but never
      // crosses a tag boundary (tags are hard scopes). Levels may skip
      // (h1 → h3): nesting is relative, driven by this comparison alone.
      let depth = stack.length
      while (depth > 0) {
        const top = stack[depth - 1]
        if (top.kind === "heading" && top.level >= level) depth--
        else break
      }
      closeDownTo(depth, Math.max(0, line.from - 1))
      const node: OutlineNode = {
        kind: "heading",
        label: h[2],
        level,
        from: line.from,
        to: line.to,
        children: [],
      }
      childrenOf().push(node)
      stack.push(node)
    }
  }

  closeDownTo(0, doc.length)
  return roots
}
