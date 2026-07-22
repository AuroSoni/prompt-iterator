// Anchored mark/edit popover: the whole mark → flag → comment loop happens at
// the selection, so annotating never requires the Inspector pane (which is
// hidden in narrow multi-pane slots). Opened by the selection pill or Mod-m;
// Radix owns Esc/click-away while it has focus, so the editor's Esc chain
// (find → x-ray → zen) never sees those keystrokes.

import { useRef } from "react"
import { Trash2 } from "lucide-react"

import { FLAGS, flagColor } from "@/lib/editor"
import type { Region, RegionInfo } from "@/lib/editor"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function RegionPopover({
  region,
  anchor,
  container,
  onPatch,
  onRemove,
  onClose,
}: {
  region: RegionInfo
  /** Frozen open-time coords, relative to the editor host (the render parent). */
  anchor: { left: number; top: number }
  /** Portal target — the editor container, so scoped CSS vars keep resolving. */
  container: HTMLElement | null
  onPatch: (id: string, patch: Partial<Region>) => void
  onRemove: (id: string) => void
  onClose: () => void
}) {
  const nameRef = useRef<HTMLInputElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // Commit pending text edits on ANY close path (Esc, click-away) — blur is
  // unreliable when the whole subtree unmounts with the popover.
  const commit = () => {
    const name = nameRef.current?.value.trim()
    if (name && name !== region.name) onPatch(region.id, { name })
    const note = noteRef.current?.value
    if (note !== undefined && note !== region.note) onPatch(region.id, { note })
  }

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) {
          commit()
          onClose()
        }
      }}
    >
      <PopoverAnchor asChild>
        <span
          className="absolute size-0"
          style={{ left: anchor.left, top: anchor.top }}
        />
      </PopoverAnchor>
      <PopoverContent
        container={container}
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-80 gap-3 p-3"
        // Land in the note: mark → type why. Name and flags stay one Tab/click
        // away.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          noteRef.current?.focus()
        }}
      >
        <input
          ref={nameRef}
          key={`name-${region.id}`}
          defaultValue={region.name}
          onBlur={(e) => {
            const name = e.target.value.trim()
            if (name && name !== region.name) onPatch(region.id, { name })
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
          }}
          aria-label="Region name"
          className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 font-mono text-[13px] font-semibold focus:border-input focus:outline-none"
        />

        <div className="flex flex-wrap gap-1.5">
          {FLAGS.map((f) => {
            const selected = region.flag === f
            return (
              <button
                key={f}
                type="button"
                onClick={() => onPatch(region.id, { flag: f })}
                className={cn(
                  "rounded-sm border px-2 py-1 text-[10px] font-medium tracking-wide uppercase",
                  !selected && "text-muted-foreground hover:bg-accent"
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

        <textarea
          ref={noteRef}
          key={`note-${region.id}`}
          defaultValue={region.note}
          placeholder="Why this exists…"
          onBlur={(e) => {
            if (e.target.value !== region.note)
              onPatch(region.id, { note: e.target.value })
          }}
          aria-label="Region note"
          className="min-h-20 w-full resize-y rounded-sm border bg-background p-2 text-xs leading-relaxed focus:border-ring focus:outline-none"
        />

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {region.tokens} tok · {region.pct}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClose()
              onRemove(region.id)
            }}
            className="h-7 gap-1.5 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3" />
            Remove
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
