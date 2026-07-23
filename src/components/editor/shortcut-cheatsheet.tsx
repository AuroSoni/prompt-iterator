// Keyboard-shortcut cheatsheet — a lightweight modal listing every editor
// binding (existing + the new fold/format ones), opened with F1 or the ? button.
// Hand-rolled overlay in the find-bar idiom (editor-local, not a shadcn ui/
// primitive). Closes on Esc / backdrop / ✕; refocuses the editor via onClose.

import { Fragment, useEffect, useRef } from "react"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

interface ShortcutCheatsheetProps {
  open: boolean
  onClose: () => void
}

interface Shortcut {
  /** One or more alternative chords; each chord is space-separated strokes,
   *  each stroke is `+`-separated keys (e.g. "Ctrl+K Ctrl+0"). */
  combos: string[]
  label: string
}

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "Folding",
    items: [
      { combos: ["Ctrl+Shift+["], label: "Fold section at caret" },
      { combos: ["Ctrl+Shift+]"], label: "Unfold at caret" },
      { combos: ["Ctrl+K Ctrl+0"], label: "Fold all" },
      { combos: ["Ctrl+K Ctrl+J"], label: "Unfold all" },
      { combos: ["Ctrl+K Ctrl+["], label: "Fold recursively" },
      { combos: ["Ctrl+K Ctrl+]"], label: "Unfold recursively" },
      { combos: ["Ctrl+K Ctrl+L"], label: "Toggle fold at caret" },
      { combos: ["Ctrl+K Ctrl+1…6"], label: "Fold to level 1–6" },
      { combos: ["Ctrl+K Ctrl+T"], label: "Fold all XML elements" },
      { combos: ["Ctrl+K Ctrl+H"], label: "Fold all headings" },
      { combos: ["Ctrl+K Ctrl+E"], label: "Fold all except current" },
    ],
  },
  {
    title: "Formatting",
    items: [{ combos: ["Shift+Alt+F"], label: "Format document (tidy whitespace)" }],
  },
  {
    title: "Editing",
    items: [
      { combos: ["Alt+↑", "Alt+↓"], label: "Move line up / down" },
      { combos: ["Shift+Alt+↑", "Shift+Alt+↓"], label: "Copy line up / down" },
      { combos: ["Ctrl+]", "Ctrl+["], label: "Indent / outdent" },
      { combos: ["Ctrl+/"], label: "Toggle line comment" },
      { combos: ["Shift+Alt+A"], label: "Toggle block comment" },
      { combos: ["Ctrl+Alt+↑", "Ctrl+Alt+↓"], label: "Add cursor above / below" },
      { combos: ["Ctrl+Shift+K"], label: "Delete line" },
      { combos: ["Ctrl+Z", "Ctrl+Y"], label: "Undo / redo" },
    ],
  },
  {
    title: "Find, modes & more",
    items: [
      { combos: ["Ctrl+F"], label: "Find" },
      { combos: ["Ctrl+H"], label: "Replace" },
      { combos: ["Ctrl+S"], label: "Save now" },
      { combos: ["Ctrl+M"], label: "Annotate region at caret" },
      { combos: ["Alt+Z"], label: "Toggle Zen focus" },
      { combos: ["Alt+X"], label: "Toggle X-ray" },
      { combos: ["Esc"], label: "Close bar / exit mode" },
      { combos: ["F1"], label: "Show this cheatsheet" },
    ],
  },
]

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

/** Windows key labels → mac glyphs, applied before splitting so chords stay intact. */
const forPlatform = (combo: string) =>
  IS_MAC
    ? combo.replace(/Ctrl/g, "⌘").replace(/Alt/g, "⌥").replace(/Shift/g, "⇧")
    : combo

function Combo({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {forPlatform(text)
        .split(" ")
        .map((stroke, si) => (
          <Fragment key={si}>
            {si > 0 && (
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                then
              </span>
            )}
            <span className="inline-flex items-center gap-0.5">
              {stroke.split("+").map((k, ki) => (
                <Fragment key={ki}>
                  {ki > 0 && <span className="text-muted-foreground">+</span>}
                  <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-b-2 bg-muted px-1 py-0.5 font-mono text-[10.5px] leading-none">
                    {k}
                  </kbd>
                </Fragment>
              ))}
            </span>
          </Fragment>
        ))}
    </span>
  )
}

export function ShortcutCheatsheet({ open, onClose }: ShortcutCheatsheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus the panel on open (so keys land here) and close on Esc even when the
  // editor no longer holds focus.
  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "max-h-full w-[42rem] max-w-full overflow-auto rounded-lg border bg-popover text-popover-foreground shadow-xl outline-none",
          "border-t-2 border-t-primary"
        )}
      >
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            aria-label="Close (Esc)"
            title="Close (Esc)"
            onClick={onClose}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 p-4 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between gap-3 text-[12.5px]"
                  >
                    <span className="text-foreground/90">{item.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {item.combos.map((c, i) => (
                        <Fragment key={c}>
                          {i > 0 && <span className="text-muted-foreground">/</span>}
                          <Combo text={c} />
                        </Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
