import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  BookmarkPlus,
  ChevronRight,
  CornerLeftUp,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Import,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  SquareSplitHorizontal,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { KindBadge } from "@/components/shell/editor-slot"
import { ResizeHandle } from "@/components/ui/resize-handle"
import {
  INDENT_BASE,
  INDENT_STEP,
  docDragItem,
  folderDragItem,
  useRowDnd,
  useSectionRootDnd,
  useSidebarDropMonitor,
  type DragItem,
  type TreeDropEvent,
} from "@/components/shell/sidebar-dnd"
import {
  bySortOrder,
  fmtTokens,
  isSelfOrDescendant,
  useLibrary,
  type Folder,
  type FolderSection,
  type Prompt,
  type Snippet,
} from "@/lib/library"
import {
  UI_LIMITS,
  expandFolder,
  pruneCollapsedFolders,
  setUiPrefs,
  toggleFolderCollapsed,
  useUiPrefs,
} from "@/lib/ui-prefs"
import { cn } from "@/lib/utils"

interface LibrarySidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  activeDocId: string | null
  openDocIds: string[]
  onOpenDoc: (docId: string) => void
  onOpenDocToSide: (docId: string) => void
  /** Create a blank prompt/snippet; resolves to its id (null on failure). */
  onCreatePrompt: () => Promise<string | null>
  onCreateSnippet: () => Promise<string | null>
  onRenameDoc: (docId: string, name: string) => void
  onDeleteDoc: (docId: string) => void
  /** Insert a snippet's text at the cursor of the active prompt (as a linked
   *  region). Reports an error if there's no editable prompt focused. */
  onInsertSnippet: (snippetId: string) => void
  /** Pin a mark-created snippet into the library list. */
  onPromoteSnippet: (snippetId: string) => void
  /** Folder CRUD (await-first store ops; failures land on the shared banner). */
  onCreateFolder: (
    section: FolderSection,
    parentId: string | null
  ) => Promise<string | null>
  onRenameFolder: (id: string, name: string) => void
  onDeleteFolder: (id: string) => void
  onMoveFolder: (id: string, parentId: string | null, index: number) => void
  onMoveDoc: (docId: string, folderId: string | null, index: number) => void
  /** Present only when Supabase is configured (there's a session to end). */
  onSignOut?: () => void
}

/** A prompt/snippet/folder being confirmed for deletion. */
interface DeleteTarget {
  id: string
  name: string
  kind: "prompt" | "snippet" | "folder"
}

// ---- Tree geometry (constants shared with the DnD hitbox in sidebar-dnd) --

const indentStyle = (depth: number) => ({
  paddingLeft: INDENT_BASE + depth * INDENT_STEP,
})

/** 2px insertion line for reorder-above/below, inset to the row's indent. */
function DropLine({ edge, depth }: { edge: "top" | "bottom"; depth: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute right-1 h-0.5 rounded-full bg-primary",
        edge === "top" ? "top-0" : "bottom-0"
      )}
      style={{ left: INDENT_BASE + depth * INDENT_STEP }}
    />
  )
}

// ---- Tree building (pure) ------------------------------------------------

interface TreeNode<T> {
  folder: Folder
  childFolders: TreeNode<T>[]
  docs: T[]
}

interface SectionTree<T> {
  rootFolders: TreeNode<T>[]
  rootDocs: T[]
}

/** Nest one section's flat folder/doc rows into a render tree. Defensive under
 *  out-of-band edits: orphans (parent missing or in the other section) fall
 *  back to the root, and corrupt parent cycles surface at the root rather than
 *  disappearing. Pass snippets ALREADY filtered to the visible set — the
 *  library filter applies inside folders too. */
function buildTree<
  T extends { id: string; folderId: string | null; sortOrder: number },
>(allFolders: Folder[], sectionDocs: T[], section: FolderSection): SectionTree<T> {
  const sectionFolders = allFolders.filter((f) => f.section === section)
  const folderIds = new Set(sectionFolders.map((f) => f.id))
  const childrenOf = new Map<string | null, Folder[]>()
  for (const f of sectionFolders) {
    const parent = f.parentId !== null && folderIds.has(f.parentId) ? f.parentId : null
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), f])
  }
  const docsOf = new Map<string | null, T[]>()
  for (const d of sectionDocs) {
    const parent = d.folderId !== null && folderIds.has(d.folderId) ? d.folderId : null
    docsOf.set(parent, [...(docsOf.get(parent) ?? []), d])
  }
  const visited = new Set<string>()
  const build = (parentId: string | null): TreeNode<T>[] =>
    (childrenOf.get(parentId) ?? [])
      .filter((f) => {
        if (visited.has(f.id)) return false
        visited.add(f.id)
        return true
      })
      .sort(bySortOrder)
      .map((folder) => ({
        folder,
        childFolders: build(folder.id),
        docs: [...(docsOf.get(folder.id) ?? [])].sort(bySortOrder),
      }))
  const rootFolders = build(null)
  // Folders inside a corrupt parent cycle are unreachable from the root walk;
  // append them at the root so nothing silently vanishes.
  for (const f of sectionFolders) {
    if (visited.has(f.id)) continue
    visited.add(f.id)
    rootFolders.push({
      folder: f,
      childFolders: build(f.id),
      docs: [...(docsOf.get(f.id) ?? [])].sort(bySortOrder),
    })
  }
  return { rootFolders, rootDocs: [...(docsOf.get(null) ?? [])].sort(bySortOrder) }
}

interface RowProps {
  docId: string
  section: FolderSection
  active: boolean
  open: boolean
  /** Tree nesting level; 0 = section root. */
  depth?: number
  onOpen: (docId: string) => void
  onOpenToSide: (docId: string) => void
  /** Trailing per-row controls (e.g. the ⋯ menu). */
  actions?: ReactNode
  children: ReactNode
}

/** One clickable library row. Click opens in the active slot; ⊞ opens to the side.
 *  Draggable (reorder within a level, drop into folders) and a reorder target
 *  for other docs of its section — never a parent (make-child blocked). */
function Row({
  docId,
  section,
  active,
  open,
  depth = 0,
  onOpen,
  onOpenToSide,
  actions,
  children,
}: RowProps) {
  const { setElement, dragging, instruction } = useRowDnd({
    item: docDragItem(docId, section),
    level: depth,
    canDrop: (s) => s.type === "doc" && s.section === section && s.id !== docId,
    block: ["make-child"],
  })
  return (
    <div
      ref={setElement}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(docId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(docId)
        }
      }}
      style={indentStyle(depth)}
      className={cn(
        "group/row relative flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-1 text-[13px] select-none",
        dragging && "opacity-50",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/60"
      )}
    >
      {instruction?.type === "reorder-above" && (
        <DropLine edge="top" depth={depth} />
      )}
      {instruction?.type === "reorder-below" && (
        <DropLine edge="bottom" depth={depth} />
      )}
      {children}
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-primary/50",
          open && !active ? "opacity-100" : "opacity-0"
        )}
        aria-hidden
      />
      <button
        type="button"
        className="invisible inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation()
          onOpenToSide(docId)
        }}
        title="Open to the side"
        aria-label="Open to the side"
      >
        <SquareSplitHorizontal className="size-3.5" />
      </button>
      {actions}
    </div>
  )
}

/** The hover ⋯ menu with Rename / Delete. Deferred with setTimeout so the menu
 *  finishes closing (and returns focus) before we mount the rename input or the
 *  delete dialog. */
function RowMenu({
  onRename,
  onDelete,
  extra,
}: {
  onRename: () => void
  onDelete: () => void
  /** Type-specific items rendered above Rename (e.g. snippet insert/promote). */
  extra?: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="invisible inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground group-hover/row:visible aria-expanded:visible hover:bg-sidebar-accent hover:text-foreground"
          title="More actions"
          aria-label="More actions"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {extra}
        <DropdownMenuItem onSelect={() => setTimeout(onRename, 0)}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setTimeout(onDelete, 0)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Inline rename field shown in place of a row. Commits on Enter/blur, cancels
 *  on Esc; the doneRef guard stops the unmount blur from firing a second time
 *  (and from overriding a cancel). */
function InlineRenameRow({
  initial,
  depth = 0,
  icon,
  onCommit,
  onCancel,
}: {
  initial: string
  depth?: number
  icon: ReactNode
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const doneRef = useRef(false)
  return (
    <div
      style={indentStyle(depth)}
      className="flex h-7 items-center gap-1.5 rounded-md pr-1"
    >
      {icon}
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter") {
            doneRef.current = true
            onCommit(value)
          } else if (e.key === "Escape") {
            doneRef.current = true
            onCancel()
          }
        }}
        onBlur={() => {
          if (!doneRef.current) onCommit(value)
        }}
        className="h-6 flex-1 px-1.5 text-[13px]"
        aria-label="Rename"
      />
    </div>
  )
}

function SectionHeader({
  children,
  onAdd,
  addLabel,
  onAddFolder,
  addFolderLabel,
  className,
}: {
  children: ReactNode
  onAdd: () => void
  addLabel: string
  onAddFolder: () => void
  addFolderLabel: string
  className?: string
}) {
  return (
    <div className={cn("flex items-center justify-between pr-1", className)}>
      <span className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {children}
      </span>
      <span className="flex items-center">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onAddFolder}
          title={addFolderLabel}
          aria-label={addFolderLabel}
          className="text-muted-foreground"
        >
          <FolderPlus />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onAdd}
          title={addLabel}
          aria-label={addLabel}
          className="text-muted-foreground"
        >
          <Plus />
        </Button>
      </span>
    </div>
  )
}

// ---- Folder rows ---------------------------------------------------------

/** Shared per-folder callbacks; one bundle serves both sections. */
interface FolderCallbacks {
  editingId: string | null
  collapsedFolders: string[]
  onToggleCollapsed: (id: string) => void
  onNewSubfolder: (section: FolderSection, parentId: string) => void
  onStartRename: (id: string) => void
  onCommitRename: (id: string, name: string) => void
  onCancelRename: () => void
  onRequestDelete: (target: DeleteTarget) => void
  onMoveToRoot: (id: string) => void
}

/** A folder header row plus (when expanded) its recursive contents. Not a
 *  `Row` — folders don't open in editor slots; the whole header toggles
 *  collapse instead. Draggable, and a drop target for same-section docs
 *  (nest) and folders (nest/reorder; own subtree excluded). */
function FolderNode<T extends { id: string }>({
  node,
  depth,
  renderDoc,
  callbacks,
}: {
  node: TreeNode<T>
  depth: number
  renderDoc: (doc: T, depth: number) => ReactNode
  callbacks: FolderCallbacks
}) {
  const { folder, childFolders, docs } = node
  const collapsed = callbacks.collapsedFolders.includes(folder.id)

  const { setElement, dragging, instruction } = useRowDnd({
    item: folderDragItem(folder.id, folder.section),
    level: depth,
    canDrop: (s) =>
      s.section === folder.section &&
      s.id !== folder.id &&
      // A folder can't drop into itself or its own subtree (no indicator at all).
      !(s.type === "folder" && isSelfOrDescendant(folder.id, s.id)),
  })

  // Hovering a make-child drop over a collapsed folder springs it open so the
  // user can keep drilling. expandFolder is idempotent, so a re-fire is safe.
  useEffect(() => {
    if (instruction?.type !== "make-child" || !collapsed) return
    const t = window.setTimeout(() => expandFolder(folder.id), 600)
    return () => window.clearTimeout(t)
  }, [instruction?.type, collapsed, folder.id])

  if (callbacks.editingId === folder.id) {
    return (
      <div>
        <InlineRenameRow
          initial={folder.name}
          depth={depth}
          icon={<FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />}
          onCommit={(name) => callbacks.onCommitRename(folder.id, name)}
          onCancel={callbacks.onCancelRename}
        />
      </div>
    )
  }

  return (
    <div>
      <div
        ref={setElement}
        role="button"
        tabIndex={0}
        onClick={() => callbacks.onToggleCollapsed(folder.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            callbacks.onToggleCollapsed(folder.id)
          }
        }}
        aria-expanded={!collapsed}
        style={indentStyle(depth)}
        className={cn(
          "group/row relative flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-1 text-[13px] select-none hover:bg-sidebar-accent/60",
          dragging && "opacity-50",
          instruction?.type === "make-child" &&
            "bg-primary/5 ring-1 ring-primary ring-inset"
        )}
      >
        {instruction?.type === "reorder-above" && (
          <DropLine edge="top" depth={depth} />
        )}
        {instruction?.type === "reorder-below" && (
          <DropLine edge="bottom" depth={depth} />
        )}
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            !collapsed && "rotate-90"
          )}
        />
        {collapsed ? (
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        <RowMenu
          extra={
            <>
              <DropdownMenuItem
                onSelect={() =>
                  setTimeout(
                    () => callbacks.onNewSubfolder(folder.section, folder.id),
                    0
                  )
                }
              >
                <FolderPlus />
                New subfolder
              </DropdownMenuItem>
              {folder.parentId !== null && (
                <DropdownMenuItem
                  onSelect={() =>
                    setTimeout(() => callbacks.onMoveToRoot(folder.id), 0)
                  }
                >
                  <CornerLeftUp />
                  Move to root
                </DropdownMenuItem>
              )}
            </>
          }
          onRename={() => callbacks.onStartRename(folder.id)}
          onDelete={() =>
            callbacks.onRequestDelete({
              id: folder.id,
              name: folder.name,
              kind: "folder",
            })
          }
        />
      </div>
      {!collapsed && (
        <>
          {childFolders.map((child) => (
            <FolderNode
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              renderDoc={renderDoc}
              callbacks={callbacks}
            />
          ))}
          {docs.map((d) => renderDoc(d, depth + 1))}
          {childFolders.length === 0 && docs.length === 0 && (
            <p
              style={indentStyle(depth + 1)}
              className="py-1 text-[11px] text-muted-foreground/60 italic select-none"
            >
              Empty
            </p>
          )}
        </>
      )}
    </div>
  )
}

interface PromptItemProps {
  prompt: Prompt
  depth?: number
  editing: boolean
  onStartRename: (id: string) => void
  onCommitRename: (id: string, name: string) => void
  onCancelRename: () => void
  onRequestDelete: (target: DeleteTarget) => void
  rowProps: Pick<
    LibrarySidebarProps,
    "activeDocId" | "openDocIds" | "onOpenDoc" | "onOpenDocToSide"
  >
}

function PromptItem({
  prompt,
  depth = 0,
  editing,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
  rowProps,
}: PromptItemProps) {
  const { activeDocId, openDocIds, onOpenDoc, onOpenDocToSide } = rowProps

  if (editing) {
    return (
      <InlineRenameRow
        initial={prompt.name}
        depth={depth}
        icon={<KindBadge kind="prompt" className="size-3.5 text-[9px]" />}
        onCommit={(name) => onCommitRename(prompt.id, name)}
        onCancel={onCancelRename}
      />
    )
  }

  // Version rows + expand chevron intentionally absent: the version UI is
  // deferred until versioning actually ships (docs of kind "version" remain in
  // the store — they're just unreachable from the sidebar for now).
  return (
    <Row
      docId={prompt.id}
      section="prompt"
      active={activeDocId === prompt.id}
      open={openDocIds.includes(prompt.id)}
      depth={depth}
      onOpen={onOpenDoc}
      onOpenToSide={onOpenDocToSide}
      actions={
        <RowMenu
          onRename={() => onStartRename(prompt.id)}
          onDelete={() =>
            onRequestDelete({ id: prompt.id, name: prompt.name, kind: "prompt" })
          }
        />
      }
    >
      <KindBadge kind="prompt" className="size-3.5 text-[9px]" />
      <span className="min-w-0 flex-1 truncate">{prompt.name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {fmtTokens(prompt.tokens)}
      </span>
    </Row>
  )
}

interface SnippetItemProps {
  snippet: Snippet
  depth?: number
  editing: boolean
  onStartRename: (id: string) => void
  onCommitRename: (id: string, name: string) => void
  onCancelRename: () => void
  onRequestDelete: (target: DeleteTarget) => void
  onInsertSnippet: (snippetId: string) => void
  onPromoteSnippet: (snippetId: string) => void
  rowProps: Pick<
    LibrarySidebarProps,
    "activeDocId" | "openDocIds" | "onOpenDoc" | "onOpenDocToSide"
  >
}

function SnippetItem({
  snippet,
  depth = 0,
  editing,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
  onInsertSnippet,
  onPromoteSnippet,
  rowProps,
}: SnippetItemProps) {
  const { activeDocId, openDocIds, onOpenDoc, onOpenDocToSide } = rowProps

  if (editing) {
    return (
      <InlineRenameRow
        initial={snippet.name}
        depth={depth}
        icon={<KindBadge kind="snippet" className="size-3.5 text-[9px]" />}
        onCommit={(name) => onCommitRename(snippet.id, name)}
        onCancel={onCancelRename}
      />
    )
  }

  return (
    <Row
      docId={snippet.id}
      section="snippet"
      active={activeDocId === snippet.id}
      open={openDocIds.includes(snippet.id)}
      depth={depth}
      onOpen={onOpenDoc}
      onOpenToSide={onOpenDocToSide}
      actions={
        <RowMenu
          extra={
            <>
              <DropdownMenuItem
                onSelect={() => setTimeout(() => onInsertSnippet(snippet.id), 0)}
              >
                <Import />
                Insert into active prompt
              </DropdownMenuItem>
              {!snippet.library && (
                <DropdownMenuItem
                  onSelect={() =>
                    setTimeout(() => onPromoteSnippet(snippet.id), 0)
                  }
                >
                  <BookmarkPlus />
                  Add to library
                </DropdownMenuItem>
              )}
            </>
          }
          onRename={() => onStartRename(snippet.id)}
          onDelete={() =>
            onRequestDelete({
              id: snippet.id,
              name: snippet.name,
              kind: "snippet",
            })
          }
        />
      }
    >
      <KindBadge kind="snippet" className="size-3.5 text-[9px]" />
      <span className="min-w-0 flex-1 truncate">{snippet.name}</span>
      {snippet.stale > 0 && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-amber-500"
          title={`${snippet.stale} of ${snippet.usedBy} using prompts are stale`}
        />
      )}
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {snippet.usedBy} use{snippet.usedBy === 1 ? "" : "s"}
      </span>
    </Row>
  )
}

export function LibrarySidebar({
  collapsed,
  onToggleCollapsed,
  activeDocId,
  openDocIds,
  onOpenDoc,
  onOpenDocToSide,
  onCreatePrompt,
  onCreateSnippet,
  onRenameDoc,
  onDeleteDoc,
  onInsertSnippet,
  onPromoteSnippet,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onMoveDoc,
  onSignOut,
}: LibrarySidebarProps) {
  const { prompts, snippets, folders } = useLibrary()
  const { sidebarWidth, collapsedFolders } = useUiPrefs()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const rowProps = { activeDocId, openDocIds, onOpenDoc, onOpenDocToSide }

  // Collapsed-state garbage collection: drop prefs for folders that no longer
  // exist (deleted here or out-of-band).
  useEffect(() => {
    pruneCollapsedFolders(new Set(folders.map((f) => f.id)))
  }, [folders])

  // Library shows only SHARED snippets: authored/promoted (library=true) or
  // referenced by 2+ regions. Filtered BEFORE nesting so it applies inside
  // folders too; a folder whose snippets are all hidden renders empty.
  const visibleSnippets = useMemo(
    () => snippets.filter((s) => s.library || s.usedBy >= 2),
    [snippets]
  )
  const promptTree = useMemo(
    () => buildTree(folders, prompts, "prompt"),
    [folders, prompts]
  )
  const snippetTree = useMemo(
    () => buildTree(folders, visibleSnippets, "snippet"),
    [folders, visibleSnippets]
  )

  const commitRename = (id: string, name: string) => {
    setEditingId(null)
    onRenameDoc(id, name)
  }
  const cancelRename = () => setEditingId(null)

  const newPrompt = async () => {
    const id = await onCreatePrompt()
    if (id) setEditingId(id)
  }
  const newSnippet = async () => {
    const id = await onCreateSnippet()
    if (id) setEditingId(id)
  }
  const newFolder = async (section: FolderSection, parentId: string | null) => {
    // A subfolder born inside a collapsed parent must be visible to rename.
    // expandFolder, NOT a toggle: this runs from a portal menu's deferred
    // handler, where a stale closure + toggle would collapse instead.
    if (parentId) expandFolder(parentId)
    const id = await onCreateFolder(section, parentId)
    if (id) setEditingId(id)
  }

  // ---- Drag-and-drop drop resolution -------------------------------------
  // Indices are computed over the FULL store lists (hidden snippets included),
  // by looking up the target's position among its siblings — never by visible
  // row counting. The store ops re-validate section/cycle/self.
  const promptSectionRef = useSectionRootDnd("prompt")
  const snippetSectionRef = useSectionRootDnd("snippet")

  const handleTreeDrop = ({ source, target, instruction }: TreeDropEvent) => {
    if (source.id === target.id || source.section !== target.section) return
    if (instruction.type === "make-child") {
      if (target.type !== "folder") return
      if (source.type === "doc") {
        onMoveDoc(source.id, target.id, Number.MAX_SAFE_INTEGER)
      } else {
        onMoveFolder(source.id, target.id, Number.MAX_SAFE_INTEGER)
      }
      return
    }
    if (instruction.type !== "reorder-above" && instruction.type !== "reorder-below") {
      return
    }
    const after = instruction.type === "reorder-below" ? 1 : 0
    if (source.type === "folder") {
      if (target.type !== "folder") return
      const targetFolder = folders.find((f) => f.id === target.id)
      if (!targetFolder) return
      const siblings = folders
        .filter(
          (f) =>
            f.section === targetFolder.section &&
            f.parentId === targetFolder.parentId &&
            f.id !== source.id
        )
        .sort(bySortOrder)
      const idx = siblings.findIndex((f) => f.id === target.id)
      if (idx === -1) return
      onMoveFolder(source.id, targetFolder.parentId, idx + after)
    } else {
      if (target.type !== "doc") return
      const list: Array<{ id: string; folderId: string | null; sortOrder: number }> =
        source.section === "prompt" ? prompts : snippets
      const targetDoc = list.find((d) => d.id === target.id)
      if (!targetDoc) return
      const siblings = list
        .filter((d) => d.folderId === targetDoc.folderId && d.id !== source.id)
        .sort(bySortOrder)
      const idx = siblings.findIndex((d) => d.id === target.id)
      if (idx === -1) return
      onMoveDoc(source.id, targetDoc.folderId, idx + after)
    }
  }

  useSidebarDropMonitor({
    onTreeDrop: handleTreeDrop,
    onRootDrop: (source: DragItem) => {
      // Drop on a section's empty space: move to root, appended.
      if (source.type === "doc") {
        onMoveDoc(source.id, null, Number.MAX_SAFE_INTEGER)
      } else {
        onMoveFolder(source.id, null, Number.MAX_SAFE_INTEGER)
      }
    },
  })

  const folderCallbacks: FolderCallbacks = {
    editingId,
    collapsedFolders,
    onToggleCollapsed: toggleFolderCollapsed,
    onNewSubfolder: (section, parentId) => void newFolder(section, parentId),
    onStartRename: setEditingId,
    onCommitRename: (id, name) => {
      setEditingId(null)
      onRenameFolder(id, name)
    },
    onCancelRename: cancelRename,
    onRequestDelete: setDeleteTarget,
    // Append at the end of the root level (the store clamps the index).
    onMoveToRoot: (id) => onMoveFolder(id, null, Number.MAX_SAFE_INTEGER),
  }

  const renderPrompt = (prompt: Prompt, depth: number) => (
    <PromptItem
      key={prompt.id}
      prompt={prompt}
      depth={depth}
      editing={editingId === prompt.id}
      onStartRename={setEditingId}
      onCommitRename={commitRename}
      onCancelRename={cancelRename}
      onRequestDelete={setDeleteTarget}
      rowProps={rowProps}
    />
  )
  const renderSnippet = (snippet: Snippet, depth: number) => (
    <SnippetItem
      key={snippet.id}
      snippet={snippet}
      depth={depth}
      editing={editingId === snippet.id}
      onStartRename={setEditingId}
      onCommitRename={commitRename}
      onCancelRename={cancelRename}
      onRequestDelete={setDeleteTarget}
      onInsertSnippet={onInsertSnippet}
      onPromoteSnippet={onPromoteSnippet}
      rowProps={rowProps}
    />
  )

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-r bg-sidebar py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapsed}
          aria-label="Expand library"
          title="Expand library"
        >
          <PanelLeftOpen />
        </Button>
      </aside>
    )
  }

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
      style={{ width: sidebarWidth }}
    >
      <ResizeHandle
        edge="end"
        value={sidebarWidth}
        min={UI_LIMITS.sidebarWidth.min}
        max={UI_LIMITS.sidebarWidth.max}
        defaultValue={UI_LIMITS.sidebarWidth.def}
        onChange={(w, commit) =>
          setUiPrefs({ sidebarWidth: w }, { persist: commit })
        }
        label="Resize library sidebar"
        className="absolute inset-y-0 -right-0.5"
      />
      <header className="flex h-10 shrink-0 items-center justify-between border-b pr-1.5 pl-3">
        <h1 className="text-[13px] font-semibold tracking-tight">
          Prompt Workbench
        </h1>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapsed}
          aria-label="Collapse library"
          title="Collapse library"
        >
          <PanelLeftClose />
        </Button>
      </header>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        <SectionHeader
          onAdd={() => void newPrompt()}
          addLabel="New prompt"
          onAddFolder={() => void newFolder("prompt", null)}
          addFolderLabel="New prompt folder"
        >
          Prompts
        </SectionHeader>
        {/* Section container = the "empty space" drop target (move to root). */}
        <div ref={promptSectionRef} className="pb-1">
          {promptTree.rootFolders.map((node) => (
            <FolderNode
              key={node.folder.id}
              node={node}
              depth={0}
              renderDoc={renderPrompt}
              callbacks={folderCallbacks}
            />
          ))}
          {promptTree.rootDocs.map((p) => renderPrompt(p, 0))}
        </div>

        <SectionHeader
          onAdd={() => void newSnippet()}
          addLabel="New snippet"
          onAddFolder={() => void newFolder("snippet", null)}
          addFolderLabel="New snippet folder"
          className="mt-4"
        >
          Snippets
        </SectionHeader>
        {visibleSnippets.length === 0 && (
          <p className="px-2 py-1 text-[12px] leading-relaxed text-muted-foreground">
            No shared snippets yet. Mark a region in a prompt, then reuse it.
          </p>
        )}
        <div ref={snippetSectionRef} className="pb-1">
          {snippetTree.rootFolders.map((node) => (
            <FolderNode
              key={node.folder.id}
              node={node}
              depth={0}
              renderDoc={renderSnippet}
              callbacks={folderCallbacks}
            />
          ))}
          {snippetTree.rootDocs.map((s) => renderSnippet(s, 0))}
        </div>
      </nav>

      {onSignOut && (
        <div className="shrink-0 border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onSignOut}
            className="w-full justify-start gap-2 text-muted-foreground"
          >
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{deleteTarget?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "prompt"
                ? "This permanently deletes the prompt and its saved version history. This can't be undone."
                : deleteTarget?.kind === "snippet"
                  ? "This removes the snippet from the library. Prompts that used it keep their copied text — they just stop tracking it. This can't be undone."
                  : "Everything inside moves up one level — no prompts, snippets, or subfolders are deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={() => {
                  if (deleteTarget?.kind === "folder") {
                    onDeleteFolder(deleteTarget.id)
                  } else if (deleteTarget) {
                    onDeleteDoc(deleteTarget.id)
                  }
                  setDeleteTarget(null)
                }}
              >
                Delete
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
