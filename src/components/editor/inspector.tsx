// The Inspector: a Google-Docs-style list of EVERY region in the doc — flag,
// name, comment preview — with click-to-navigate. The caret's region expands
// in place to the full editing UI (name / flags / note / snippet link /
// remove); everything else stays a scannable card. Extracted from
// prompt-editor.tsx (SnippetLink and SnippetDocPanel moved verbatim).

import { useEffect, useRef, useState } from "react"
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookmarkPlus,
  Trash2,
} from "lucide-react"

import { FLAGS, flagColor } from "@/lib/editor"
import type { Flag, Region, RegionInfo } from "@/lib/editor"
import { getSnippetBody, useLibrary } from "@/lib/library"
import type { DocKind, Snippet } from "@/lib/library"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The region↔snippet link panel: shows the linked snippet's name, usage, and
// version, and the region's sync state (in sync / update available / local
// edits / diverged) with the matching pull / push / promote actions. An
// unlinked (or dangling) region gets a "make reusable" affordance instead.
function SnippetLink({
  region,
  regionText,
  snippet,
  readOnly,
  onPull,
  onPush,
  onPromote,
  onMakeReusable,
}: {
  region: RegionInfo
  regionText: string
  snippet: Snippet | undefined
  readOnly: boolean
  onPull: (region: Region) => void
  onPush: (region: Region) => void
  onPromote: (region: Region) => void
  onMakeReusable: (region: Region) => void
}) {
  // Unlinked, or dangling after its snippet was deleted: offer to (re)link.
  if (!region.snippetId || !snippet) {
    return readOnly ? null : (
      <Button
        size="sm"
        variant="outline"
        onClick={() => onMakeReusable(region)}
        className="h-7 w-full justify-center gap-1.5 text-[11px]"
      >
        <BookmarkPlus className="size-3.5" /> Make reusable snippet
      </Button>
    )
  }

  const behind = (region.syncedVersion ?? 0) < snippet.version
  const canonical = getSnippetBody(region.snippetId)
  const diverged = canonical !== undefined && regionText !== canonical
  const state = behind && diverged
    ? "diverged"
    : behind
      ? "update"
      : diverged
        ? "local"
        : "synced"
  const label =
    state === "synced"
      ? "in sync"
      : state === "update"
        ? "update available"
        : state === "local"
          ? "local edits"
          : "diverged"

  return (
    <div className="rounded-sm border bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
          {snippet.name}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          v{snippet.version}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        snippet · used in {snippet.usedBy}{" "}
        {snippet.usedBy === 1 ? "place" : "places"} · {label}
      </div>
      {/* One-way rollup: the snippet's own note, read-only here. To edit it,
          open the snippet — the region's NOTE below stays prompt-local. */}
      {snippet.note.trim() !== "" && (
        <div className="mt-1.5 border-t pt-1.5">
          <div className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground">
            SNIPPET NOTE
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {snippet.note}
          </p>
        </div>
      )}
      {!readOnly && (state !== "synced" || !snippet.library) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(state === "update" || state === "diverged") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (
                  state === "diverged" &&
                  !window.confirm(
                    "Pull replaces this region's local edits with the snippet's current text. Continue?"
                  )
                )
                  return
                onPull(region)
              }}
              className="h-7 gap-1 text-[11px]"
            >
              <ArrowDownToLine className="size-3.5" />
              {state === "diverged" ? "Pull" : `Update to v${snippet.version}`}
            </Button>
          )}
          {(state === "local" || state === "diverged") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPush(region)}
              className="h-7 gap-1 text-[11px]"
            >
              <ArrowUpFromLine className="size-3.5" /> Save as v
              {snippet.version + 1}
            </Button>
          )}
          {!snippet.library && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onPromote(region)}
              className="h-7 gap-1 text-[11px]"
            >
              <BookmarkPlus className="size-3.5" /> Add to library
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// Doc-level panel shown when the SNIPPET ITSELF is open: identity, live
// usage, and the snippet's own note — the source of the one-way rollup that
// prompt inspectors render read-only.
function SnippetDocPanel({
  snippet,
  readOnly,
  onUpdateNote,
}: {
  snippet: Snippet
  readOnly: boolean
  onUpdateNote: (snippetId: string, note: string) => void
}) {
  return (
    <div className="mt-3 space-y-4">
      <div className="rounded-sm border bg-muted/30 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
            {snippet.name}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
            v{snippet.version}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          used in {snippet.usedBy} {snippet.usedBy === 1 ? "place" : "places"}
          {snippet.stale > 0 && <> · {snippet.stale} behind</>}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">
          NOTE — WHY THIS EXISTS
        </div>
        {/* Uncontrolled + keyed by the committed value: remounts on external
            change; can't fire mid-typing (only this textarea edits the note). */}
        <textarea
          key={snippet.note}
          defaultValue={snippet.note}
          disabled={readOnly}
          onBlur={(e) => {
            if (e.target.value !== snippet.note)
              onUpdateNote(snippet.id, e.target.value)
          }}
          aria-label="Snippet note"
          className="min-h-24 w-full resize-y rounded-sm border bg-background p-2 text-xs leading-relaxed focus:border-ring focus:outline-none disabled:opacity-70"
        />
      </div>
    </div>
  )
}

/** Collapsed region entry: one glance = flag, name, linkage, size, comment. */
function RegionCard({
  region,
  onJump,
}: {
  region: RegionInfo
  onJump: (r: Region) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(region)}
      className="block w-full rounded-md border border-transparent bg-muted/30 p-2.5 text-left hover:bg-accent/50"
    >
      <span className="flex items-center gap-1.5">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: flagColor(region.flag) }}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
          {region.name}
        </span>
        {region.snippetId && (
          <span
            className="shrink-0 text-[10px] text-muted-foreground"
            title="Linked snippet"
          >
            ⧉
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {region.tokens}t
        </span>
      </span>
      {region.note.trim().length > 0 && (
        <span className="mt-1 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
          {region.note}
        </span>
      )}
    </button>
  )
}

function FilterChip({
  active,
  flag,
  label,
  onClick,
}: {
  active: boolean
  flag?: Flag
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide",
        active
          ? !flag && "border-foreground/50"
          : "border-transparent text-muted-foreground hover:bg-accent"
      )}
      style={
        active && flag
          ? {
              borderColor: flagColor(flag),
              color: flagColor(flag),
              background: `color-mix(in oklch, ${flagColor(flag)} 10%, transparent)`,
            }
          : undefined
      }
    >
      {label}
    </button>
  )
}

export function Inspector({
  regions,
  activeRegionId,
  activeRegionText,
  docId,
  docKind,
  readOnly,
  onJump,
  onPatch,
  onRemove,
  onPull,
  onPush,
  onPromote,
  onMakeReusable,
  onUpdateSnippetNote,
  className,
  style,
}: {
  regions: RegionInfo[]
  activeRegionId: string | null
  /** Current text of the ACTIVE region — drives the snippet-drift signal. */
  activeRegionText: string
  docId: string
  docKind: DocKind
  readOnly: boolean
  onJump: (r: Region) => void
  onPatch: (id: string, patch: Partial<Region>) => void
  onRemove: (id: string) => void
  onPull: (region: Region) => void
  onPush: (region: Region) => void
  onPromote: (region: Region) => void
  onMakeReusable: (region: Region) => void
  onUpdateSnippetNote: (snippetId: string, note: string) => void
  className?: string
  style?: React.CSSProperties
}) {
  // Subscribe so link panels reflect live snippet version/usage counts.
  const lib = useLibrary()
  const [filter, setFilter] = useState<Flag | "all">("all")
  const activeCardRef = useRef<HTMLDivElement>(null)

  // A snippet doc's id IS its snippet id (docs.set(sr.id, …) on hydrate).
  const self =
    docKind === "snippet" ? lib.snippets.find((s) => s.id === docId) : undefined

  const shown =
    filter === "all" ? regions : regions.filter((r) => r.flag === filter)

  // Keep the caret's card in view as the caret moves between regions.
  useEffect(() => {
    activeCardRef.current?.scrollIntoView({ block: "nearest" })
  }, [activeRegionId])

  return (
    <aside className={cn("overflow-y-auto p-4", className)} style={style}>
      <h3 className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
        INSPECTOR
      </h3>

      {self && (
        <SnippetDocPanel
          snippet={self}
          readOnly={readOnly}
          onUpdateNote={onUpdateSnippetNote}
        />
      )}

      {regions.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          No regions yet.
          {readOnly ? "" : " Select text and mark one — the pill, or Ctrl+M."}
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1">
            <FilterChip
              active={filter === "all"}
              label={`all ${regions.length}`}
              onClick={() => setFilter("all")}
            />
            {FLAGS.map((f) => {
              const n = regions.filter((r) => r.flag === f).length
              if (n === 0) return null
              return (
                <FilterChip
                  key={f}
                  active={filter === f}
                  flag={f}
                  label={`${f} ${n}`}
                  onClick={() => setFilter(filter === f ? "all" : f)}
                />
              )
            })}
          </div>

          <div className="mt-3 space-y-2">
            {shown.map((region) => {
              if (region.id !== activeRegionId) {
                return (
                  <RegionCard key={region.id} region={region} onJump={onJump} />
                )
              }
              const snippet =
                region.snippetId != null
                  ? lib.snippets.find((s) => s.id === region.snippetId)
                  : undefined
              return (
                // Key by region id: uncontrolled fields reset when the region
                // changes, but survive re-renders while typing.
                <div
                  key={region.id}
                  ref={activeCardRef}
                  className="space-y-4 rounded-md border bg-accent/30 p-3"
                  style={{ borderColor: flagColor(region.flag) }}
                >
                  <input
                    defaultValue={region.name}
                    disabled={readOnly}
                    onBlur={(e) => {
                      const name = e.target.value.trim()
                      if (name && name !== region.name)
                        onPatch(region.id, { name })
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur()
                    }}
                    aria-label="Region name"
                    className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 font-mono text-[13px] font-semibold focus:border-input focus:outline-none disabled:opacity-70"
                  />

                  <SnippetLink
                    region={region}
                    regionText={activeRegionText}
                    snippet={snippet}
                    readOnly={readOnly}
                    onPull={onPull}
                    onPush={onPush}
                    onPromote={onPromote}
                    onMakeReusable={onMakeReusable}
                  />

                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">
                      FLAG
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {FLAGS.map((f) => {
                        const selected = region.flag === f
                        return (
                          <button
                            key={f}
                            type="button"
                            disabled={readOnly}
                            onClick={() => onPatch(region.id, { flag: f })}
                            className={cn(
                              "rounded-sm border px-2 py-1 text-[10px] font-medium tracking-wide uppercase disabled:pointer-events-none disabled:opacity-50",
                              !selected &&
                                "text-muted-foreground hover:bg-accent"
                            )}
                            style={
                              selected
                                ? {
                                    borderColor: flagColor(f),
                                    color: flagColor(f),
                                    background: `color-mix(in oklch, ${flagColor(f)} 10%, transparent)`,
                                  }
                                : undefined
                            }
                          >
                            {f}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">
                      NOTE — WHY THIS EXISTS
                    </div>
                    <textarea
                      defaultValue={region.note}
                      disabled={readOnly}
                      onBlur={(e) => {
                        if (e.target.value !== region.note)
                          onPatch(region.id, { note: e.target.value })
                      }}
                      aria-label="Region note"
                      className="min-h-24 w-full resize-y rounded-sm border bg-background p-2 text-xs leading-relaxed focus:border-ring focus:outline-none disabled:opacity-70"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-sm border bg-muted/40 p-2">
                      <div className="text-base font-bold tabular-nums">
                        {region.tokens}
                      </div>
                      <div className="mt-0.5 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground">
                        TOKENS
                      </div>
                    </div>
                    <div className="rounded-sm border bg-muted/40 p-2">
                      <div className="text-base font-bold tabular-nums">
                        {region.pct}%
                      </div>
                      <div className="mt-0.5 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground">
                        OF PROMPT
                      </div>
                    </div>
                  </div>

                  {/* Removing the annotation leaves the prose it covered. */}
                  {!readOnly && (
                    <div className="border-t pt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemove(region.id)}
                        className="h-8 w-full justify-start gap-2 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                        Remove region
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
            {shown.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No {filter} regions.
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
