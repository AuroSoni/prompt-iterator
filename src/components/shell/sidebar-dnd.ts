// Sidebar tree drag-and-drop hooks on @atlaskit/pragmatic-drag-and-drop
// (headless: draggable/dropTarget attach to the existing row DOM). The
// tree-item hitbox turns pointer position into an Instruction — reorder-above /
// reorder-below / make-child — with an indent-aware zone per row; we normalize
// those to this tree's rules (see sidebar-tree.ts) and hand clean events to the
// sidebar. All moves are validated again in the store (section, cycle, self) —
// the guards here only shape the hover affordance.
//
// This module exports ONLY hooks — the payload shape, guards, constants, and
// the instruction normalizer live in the React-free sidebar-tree.ts. That split
// keeps each file a clean Fast Refresh boundary (mixing hooks with plain value
// exports breaks HMR: it duplicates the shared imports on reload).

import { useEffect, useRef, useState } from "react"

import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine"
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import {
  attachInstruction,
  extractInstruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item"
import type { Instruction } from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item"

import type { FolderSection } from "@/lib/library"
import {
  DND_KEY,
  INDENT_STEP,
  isDragItem,
  isSectionRoot,
  normalizeInstruction,
  type DragItem,
  type RowDndState,
  type TreeDropEvent,
} from "@/components/shell/sidebar-tree"

/** Make one tree row draggable and a drop target with tree-item semantics.
 *  Guards and payload are read through refs, so re-renders don't re-attach
 *  listeners; the element itself is state, so remounts re-register. */
export function useRowDnd(opts: {
  item: DragItem
  /** Tree depth (0 = section root) — feeds the hitbox's indent zones. */
  level: number
  /** Extra per-row acceptance (same-section / not-self / not-descendant). */
  canDrop: (source: DragItem) => boolean
  /** Statically blocked instruction types (doc rows block "make-child"). */
  block?: Instruction["type"][]
}): RowDndState {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [instruction, setInstruction] = useState<Instruction | null>(null)
  const { item, level } = opts
  const optsRef = useRef(opts)
  optsRef.current = opts
  const blockKey = opts.block?.join(",") ?? ""

  useEffect(() => {
    if (!element) return
    const block = blockKey
      ? (blockKey.split(",") as Instruction["type"][])
      : undefined
    return combine(
      draggable({
        element,
        getInitialData: () => ({ ...optsRef.current.item }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) =>
          isDragItem(source.data) && optsRef.current.canDrop(source.data),
        getData: ({ input, element: el }) =>
          attachInstruction(
            { ...optsRef.current.item },
            {
              input,
              element: el,
              currentLevel: optsRef.current.level,
              indentPerLevel: INDENT_STEP,
              mode: "standard",
              block,
            }
          ),
        onDrag: ({ source, self }) =>
          setInstruction(
            isDragItem(source.data)
              ? normalizeInstruction(
                  source.data,
                  optsRef.current.item,
                  extractInstruction(self.data)
                )
              : null
          ),
        onDragLeave: () => setInstruction(null),
        onDrop: () => setInstruction(null),
      })
    )
  }, [element, item.id, item.type, item.section, level, blockKey])

  return { setElement, dragging, instruction }
}

/** Register a section's list container as the "empty space" drop target: a
 *  drop that lands on no row moves the item to the section root (append).
 *  Rows nest inside it, so the innermost drop target wins when over a row —
 *  this also gives per-section scoping a physical boundary. Element-as-state
 *  for the same remount reason as useRowDnd (the sidebar collapse cycle
 *  unmounts the containers). */
export function useSectionRootDnd(
  section: FolderSection
): (el: HTMLDivElement | null) => void {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!element) return
    return dropTargetForElements({
      element,
      canDrop: ({ source }) =>
        isDragItem(source.data) && source.data.section === section,
      getData: () => ({ dnd: DND_KEY, type: "section-root", section }),
    })
  }, [element, section])
  return setElement
}

/** One app-level monitor that resolves every sidebar drop to either a tree
 *  drop (row target + normalized instruction) or a section-root drop. */
export function useSidebarDropMonitor(handlers: {
  onTreeDrop: (e: TreeDropEvent) => void
  onRootDrop: (source: DragItem, section: FolderSection) => void
}): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => isDragItem(source.data),
        onDrop({ source, location }) {
          const src = source.data
          if (!isDragItem(src)) return
          // Innermost target first: a row when over a row, else the section.
          const target = location.current.dropTargets[0]
          if (!target) return
          if (isSectionRoot(target.data)) {
            if (target.data.section === src.section) {
              handlersRef.current.onRootDrop(src, target.data.section)
            }
            return
          }
          if (!isDragItem(target.data)) return
          const instruction = normalizeInstruction(
            src,
            target.data,
            extractInstruction(target.data)
          )
          if (instruction) {
            handlersRef.current.onTreeDrop({
              source: src,
              target: target.data,
              instruction,
            })
          }
        },
      }),
    []
  )
}
