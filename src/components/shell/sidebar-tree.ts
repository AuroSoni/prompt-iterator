// Pure model + geometry for the sidebar tree drag-and-drop: the drag payload
// shape, its type guards, the indent constants, and the hitbox-instruction
// normalizer. Deliberately React-free — the DnD *hooks* live in sidebar-dnd.ts.
// Keeping constants/functions out of the hooks module is what makes each file
// a clean React Fast Refresh unit (a module that mixes hooks with plain value
// exports isn't a valid refresh boundary, which corrupts HMR).

import type { Instruction } from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item"

import type { FolderSection } from "@/lib/library"

/** Tree indent geometry, shared by row padding, drop-indicator inset, and the
 *  hitbox's indent-aware zones (`indentPerLevel`). */
export const INDENT_STEP = 16
export const INDENT_BASE = 8

/** Discriminator gating out foreign drags (text selections, files, other apps'
 *  pragmatic payloads). */
export const DND_KEY = "pw-sidebar"

export interface DragItem {
  dnd: typeof DND_KEY
  type: "doc" | "folder"
  id: string
  section: FolderSection
}

export interface SectionRootData {
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

export function isSectionRoot(data: unknown): data is SectionRootData {
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

export interface TreeDropEvent {
  source: DragItem
  target: DragItem
  instruction: Instruction
}
