import { useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  BookmarkPlus,
  ChevronRight,
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
import { fmtTokens, useLibrary, type Prompt } from "@/lib/library"
import { UI_LIMITS, setUiPrefs, useUiPrefs } from "@/lib/ui-prefs"
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
  /** Present only when Supabase is configured (there's a session to end). */
  onSignOut?: () => void
}

/** A prompt/snippet being confirmed for deletion. */
interface DeleteTarget {
  id: string
  name: string
  kind: "prompt" | "snippet"
}

interface RowProps {
  docId: string
  active: boolean
  open: boolean
  indent?: boolean
  onOpen: (docId: string) => void
  onOpenToSide: (docId: string) => void
  /** Trailing per-row controls (e.g. the ⋯ menu). Absent on version rows. */
  actions?: ReactNode
  children: ReactNode
}

/** One clickable library row. Click opens in the active slot; ⊞ opens to the side. */
function Row({
  docId,
  active,
  open,
  indent,
  onOpen,
  onOpenToSide,
  actions,
  children,
}: RowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(docId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(docId)
        }
      }}
      className={cn(
        "group/row flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-1 text-[13px] select-none",
        indent ? "pl-8" : "pl-2",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/60"
      )}
    >
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
  indent,
  icon,
  onCommit,
  onCancel,
}: {
  initial: string
  indent?: boolean
  icon: ReactNode
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const doneRef = useRef(false)
  return (
    <div
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md pr-1",
        indent ? "pl-8" : "pl-2"
      )}
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
  className,
}: {
  children: ReactNode
  onAdd: () => void
  addLabel: string
  className?: string
}) {
  return (
    <div className={cn("flex items-center justify-between pr-1", className)}>
      <span className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {children}
      </span>
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
    </div>
  )
}

interface PromptItemProps {
  prompt: Prompt
  expanded: boolean
  editing: boolean
  onToggleExpanded: () => void
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
  expanded,
  editing,
  onToggleExpanded,
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
        icon={<KindBadge kind="prompt" className="size-3.5 text-[9px]" />}
        onCommit={(name) => onCommitRename(prompt.id, name)}
        onCancel={onCancelRename}
      />
    )
  }

  return (
    <div>
      <Row
        docId={prompt.id}
        active={activeDocId === prompt.id}
        open={openDocIds.includes(prompt.id)}
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
        <button
          type="button"
          className="-ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpanded()
          }}
          aria-label={expanded ? "Collapse versions" : "Expand versions"}
          aria-expanded={expanded}
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform",
              expanded && "rotate-90"
            )}
          />
        </button>
        <KindBadge kind="prompt" className="size-3.5 text-[9px]" />
        <span className="min-w-0 flex-1 truncate">{prompt.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {fmtTokens(prompt.tokens)}
        </span>
      </Row>
      {expanded &&
        prompt.versions.map((v) => (
          <Row
            key={v.id}
            docId={v.id}
            active={activeDocId === v.id}
            open={openDocIds.includes(v.id)}
            indent
            onOpen={onOpenDoc}
            onOpenToSide={onOpenDocToSide}
          >
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              v{v.n}
            </span>
            {v.n === prompt.currentVersion && (
              <span className="shrink-0 rounded-sm bg-sidebar-accent px-1 py-px text-[10px] font-medium text-muted-foreground">
                current
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
              {v.message}
            </span>
          </Row>
        ))}
    </div>
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
  onSignOut,
}: LibrarySidebarProps) {
  const { prompts, snippets } = useLibrary()
  const { sidebarWidth } = useUiPrefs()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const rowProps = { activeDocId, openDocIds, onOpenDoc, onOpenDocToSide }

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
        <SectionHeader onAdd={() => void newPrompt()} addLabel="New prompt">
          Prompts
        </SectionHeader>
        {prompts.map((prompt) => (
          <PromptItem
            key={prompt.id}
            prompt={prompt}
            expanded={!!expanded[prompt.id]}
            editing={editingId === prompt.id}
            onToggleExpanded={() =>
              setExpanded((e) => ({ ...e, [prompt.id]: !e[prompt.id] }))
            }
            onStartRename={setEditingId}
            onCommitRename={commitRename}
            onCancelRename={cancelRename}
            onRequestDelete={setDeleteTarget}
            rowProps={rowProps}
          />
        ))}

        <SectionHeader
          onAdd={() => void newSnippet()}
          addLabel="New snippet"
          className="mt-4"
        >
          Snippets
        </SectionHeader>
        {/* Library shows only SHARED snippets: authored/promoted (library=true)
            or referenced by 2+ regions. One-off, mark-created snippets stay
            hidden until reused. */}
        {snippets.filter((s) => s.library || s.usedBy >= 2).length === 0 && (
          <p className="px-2 py-1 text-[12px] leading-relaxed text-muted-foreground">
            No shared snippets yet. Mark a region in a prompt, then reuse it.
          </p>
        )}
        {snippets
          .filter((s) => s.library || s.usedBy >= 2)
          .map((snippet) =>
          editingId === snippet.id ? (
            <InlineRenameRow
              key={snippet.id}
              initial={snippet.name}
              icon={<KindBadge kind="snippet" className="size-3.5 text-[9px]" />}
              onCommit={(name) => commitRename(snippet.id, name)}
              onCancel={cancelRename}
            />
          ) : (
            <Row
              key={snippet.id}
              docId={snippet.id}
              active={activeDocId === snippet.id}
              open={openDocIds.includes(snippet.id)}
              onOpen={onOpenDoc}
              onOpenToSide={onOpenDocToSide}
              actions={
                <RowMenu
                  extra={
                    <>
                      <DropdownMenuItem
                        onSelect={() =>
                          setTimeout(() => onInsertSnippet(snippet.id), 0)
                        }
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
                  onRename={() => setEditingId(snippet.id)}
                  onDelete={() =>
                    setDeleteTarget({
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
        )}
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
                : "This removes the snippet from the library. Prompts that used it keep their copied text — they just stop tracking it. This can't be undone."}
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
                  if (deleteTarget) onDeleteDoc(deleteTarget.id)
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
