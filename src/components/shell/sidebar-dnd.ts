// Sidebar tree drag-and-drop on @atlaskit/pragmatic-drag-and-drop (headless:
// draggable/dropTarget attach to the existing row DOM). The tree-item hitbox
// turns pointer position into an Instruction — reorder-above / reorder-below /
// make-child — with an indent-aware zone per row; we normalize those to this
// tree's rules and hand clean events to the sidebar. All moves are validated
// again in the store (section, cycle, self) — the guards here only shape the
// hover affordance.

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

/** Tree indent geometry, shared by row padding, drop-indicator inset, and the
 *  hitbox's indent-aware zones (`indentPerLevel`). */
export const INDENT_STEP = 16
export const INDENT_BASE = 8

/** Discriminator gating out foreign drags (text selections, files, other apps'
 *  pragmatic payloads). */
const DND_KEY = "pw-sidebar"

export interface DragItem {
  dnd: typeof DND_KEY
  type: "doc" | "folder"
  id: string
  section: FolderSection
}

interface SectionRootData {
  dnd: typeof DND_KEY
  type: "section-root"
  section: FolderSection
}

export function docDragItem(id: string, section: FolderSection): DragItem {
  return { dnd: DND_KEY, type: "doc", id, section }
}

export function folderDragItem(id: string, section: FolderSection): DragItem {
  return { dnd: DND_KEY, type: "folder", id, section }
}

export function isDragItem(data: unknown): data is DragItem {
  if (typeof data !== "object" || data === null) return false
  const d = data as Record<string, unknown>
  return d.dnd === DND_KEY && (d.type === "doc" || d.type === "folder")
}

function isSectionRoot(data: unknown): data is SectionRootData {
  if (typeof data !== "object" || data === null) return false
  const d = data as Record<string, unknown>
  return d.dnd === DND_KEY && d.type === "section-root"
}

/** Canonicalize a hitbox instruction to this tree's rules: a doc dropped
 *  anywhere on a folder row nests into it ("reorder a doc between folders" is
 *  meaningless — folders sort above docs at every level); docs never become
 *  parents; blocked/exotic instructions are ignored. */
export function normalizeInstruction(
  source: DragItem,
  target: DragItem,
  instruction: Instruction | null
): Instruction | null {
  if (!instruction) return null
  if (instruction.type === "instruction-blocked" || instruction.type === "reparent") {
    return null // reparent is unreachable under mode:"standard"; blocked is blocked
  }
  if (source.type === "doc" && target.type === "folder") {
    return instruction.type === "make-child"
      ? instruction
      : { type: "make-child", currentLevel: instruction.currentLevel, indentPerLevel: instruction.indentPerLevel }
  }
  if (source.type === "doc" && target.type === "doc" && instruction.type === "make-child") {
    return null // belt-and-braces with the doc rows' static block
  }
  if (source.type === "folder" && target.type === "doc") return null
  return instruction
}

export interface RowDndState {
  /** Attach as the row element's `ref`. Element-as-state (NOT a RefObject):
   *  rows mount conditionally (inline rename swaps the row out), so
   *  registration must re-run when the real DOM node (re)appears — an effect
   *  keyed on a stable RefObject never would. */
  setElement: (el: HTMLDivElement | null) => void
  /** This row is the drag source of an in-flight drag. */
  dragging: boolean
  /** Normalized hover instruction while a valid drag is over this row. */
  instruction: Instruction | null
}

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

export interface TreeDropEvent {
  source: DragItem
  target: DragItem
  instruction: Instruction
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
