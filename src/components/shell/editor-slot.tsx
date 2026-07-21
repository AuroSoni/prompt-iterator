import type {
  IDockviewPanelHeaderProps,
  IDockviewPanelProps,
} from "dockview-react"
import { Lock, X } from "lucide-react"

import { fmtTokens, getDoc, type DocKind } from "@/lib/library"
import { cn } from "@/lib/utils"

/** Params carried by every generic editor slot — the doc it displays. */
export interface SlotParams {
  docId: string
  [key: string]: unknown
}

const KIND_STYLES: Record<DocKind, { label: string; className: string }> = {
  prompt: {
    label: "P",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
  snippet: {
    label: "S",
    className:
      "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  },
  version: {
    label: "V",
    className:
      "bg-stone-200 text-stone-600 dark:bg-stone-500/20 dark:text-stone-300",
  },
}

export function KindBadge({
  kind,
  className,
}: {
  kind: DocKind
  className?: string
}) {
  const style = KIND_STYLES[kind]
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold",
        style.className,
        className
      )}
    >
      {style.label}
    </span>
  )
}

/** Panel content: a generic editor slot rendering whatever doc it carries. */
export function EditorSlotPanel({ params }: IDockviewPanelProps<SlotParams>) {
  const doc = getDoc(params.docId)

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Document not found.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-card-foreground">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <KindBadge kind={doc.kind} />
        <span className="truncate font-medium text-foreground">{doc.title}</span>
        {doc.readOnly && (
          <span className="inline-flex shrink-0 items-center gap-1">
            <Lock className="size-3" />
            read-only
          </span>
        )}
        <span className="ml-auto shrink-0 tabular-nums">
          {fmtTokens(doc.tokens)} tok
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-prose text-sm leading-6 whitespace-pre-wrap">
          {doc.body}
        </div>
      </div>
      <div className="shrink-0 border-t border-dashed px-3 py-1.5 text-[11px] text-muted-foreground">
        Placeholder slot — the CodeMirror 6 editor (Cockpit / Zen) mounts here
        in Phase 1 core editing.
      </div>
    </div>
  )
}

/** Custom tab: kind badge + title + close, so slots read at a glance. */
export function DocTab({ params, api }: IDockviewPanelHeaderProps<SlotParams>) {
  const doc = getDoc(params.docId)

  return (
    <div className="flex h-full items-center gap-1.5 pr-1 pl-2 text-xs">
      {doc && <KindBadge kind={doc.kind} className="size-3.5 text-[9px]" />}
      <span className="max-w-40 truncate">{doc?.title ?? params.docId}</span>
      <button
        type="button"
        className="ml-0.5 inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        // Keep the close click from starting a tab drag or activating the panel.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          api.close()
        }}
        aria-label={`Close ${doc?.title ?? "panel"}`}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

/** Shown when every slot is closed. */
export function WorkspaceWatermark() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
      <p className="text-sm font-medium">No document open</p>
      <p className="text-xs">
        Select a prompt, version, or snippet from the library.
      </p>
    </div>
  )
}
