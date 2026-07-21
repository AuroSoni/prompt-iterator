import { useState } from "react"
import type { ReactNode } from "react"
import {
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  SquareSplitHorizontal,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { KindBadge } from "@/components/shell/editor-slot"
import { fmtTokens, PROMPTS, SNIPPETS, type Prompt } from "@/lib/library"
import { cn } from "@/lib/utils"

interface LibrarySidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  activeDocId: string | null
  openDocIds: string[]
  onOpenDoc: (docId: string) => void
  onOpenDocToSide: (docId: string) => void
}

interface RowProps {
  docId: string
  active: boolean
  open: boolean
  indent?: boolean
  onOpen: (docId: string) => void
  onOpenToSide: (docId: string) => void
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
    </div>
  )
}

function SectionLabel({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase",
        className
      )}
    >
      {children}
    </div>
  )
}

interface PromptItemProps {
  prompt: Prompt
  expanded: boolean
  onToggleExpanded: () => void
  rowProps: Pick<
    LibrarySidebarProps,
    "activeDocId" | "openDocIds" | "onOpenDoc" | "onOpenDocToSide"
  >
}

function PromptItem({
  prompt,
  expanded,
  onToggleExpanded,
  rowProps,
}: PromptItemProps) {
  const { activeDocId, openDocIds, onOpenDoc, onOpenDocToSide } = rowProps
  return (
    <div>
      <Row
        docId={prompt.id}
        active={activeDocId === prompt.id}
        open={openDocIds.includes(prompt.id)}
        onOpen={onOpenDoc}
        onOpenToSide={onOpenDocToSide}
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
}: LibrarySidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const rowProps = { activeDocId, openDocIds, onOpenDoc, onOpenDocToSide }

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
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
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
        <SectionLabel>Prompts</SectionLabel>
        {PROMPTS.map((prompt) => (
          <PromptItem
            key={prompt.id}
            prompt={prompt}
            expanded={!!expanded[prompt.id]}
            onToggleExpanded={() =>
              setExpanded((e) => ({ ...e, [prompt.id]: !e[prompt.id] }))
            }
            rowProps={rowProps}
          />
        ))}
        <SectionLabel className="mt-4">Snippets</SectionLabel>
        {SNIPPETS.map((snippet) => (
          <Row
            key={snippet.id}
            docId={snippet.id}
            active={activeDocId === snippet.id}
            open={openDocIds.includes(snippet.id)}
            onOpen={onOpenDoc}
            onOpenToSide={onOpenDocToSide}
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
        ))}
      </nav>
    </aside>
  )
}
