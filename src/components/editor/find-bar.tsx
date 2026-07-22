// VS Code-style find/replace bar (Phase-0 design-shotgun winner, variant A).
// A React overlay pinned top-right of the editor pane that drives the CM
// findField: it owns the query/toggles/replacement, computes matches over the
// live doc, and dispatches highlights + replacements against the EditorView.
//
// Match state lives in CM (findField) so highlights paint and map through
// edits; the bar mirrors just the count/current for display. A parent-supplied
// `docEpoch` (bumped on docChanged while open) triggers a re-search after any
// edit or replace, without re-searching on scroll/selection.

import { useCallback, useEffect, useRef, useState } from "react"
import type { EditorView } from "@codemirror/view"
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Regex,
  Replace,
  ReplaceAll,
  X,
} from "lucide-react"

import {
  buildQuery,
  clearFind,
  findMatches,
  gotoMatch,
  linkedMatchCount,
  replaceRanges,
  replFor,
  setFind,
} from "@/lib/find"
import type { FindMatch, FindOpts } from "@/lib/find"
import { cn } from "@/lib/utils"

interface FindBarProps {
  view: EditorView | null
  replaceMode: boolean
  readOnly: boolean
  /** Bumped by the parent on docChanged (only while open) → re-search. */
  docEpoch: number
  onClose: () => void
  onReplaceModeChange: (on: boolean) => void
  className?: string
}

const INITIAL_OPTS: FindOpts = { caseSense: false, word: false, regex: false }

export function FindBar({
  view,
  replaceMode,
  readOnly,
  docEpoch,
  onClose,
  onReplaceModeChange,
  className,
}: FindBarProps) {
  // Prefill from a single-line selection (once, on mount) so "search the thing
  // I highlighted" works without a keystroke.
  const [query, setQuery] = useState(() => {
    if (!view) return ""
    const sel = view.state.selection.main
    if (sel.empty) return ""
    const text = view.state.sliceDoc(sel.from, sel.to)
    return text.length <= 200 && !text.includes("\n") ? text : ""
  })
  const [replacement, setReplacement] = useState("")
  const [opts, setOpts] = useState<FindOpts>(INITIAL_OPTS)
  const [count, setCount] = useState(0)
  const [current, setCurrent] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const [linked, setLinked] = useState(0)

  const queryRef = useRef<HTMLInputElement>(null)
  // Live matches mirror (not React state — avoids a render per nav; the CM
  // findField is the paint source of truth).
  const matchesRef = useRef<FindMatch[]>([])
  const currentRef = useRef(-1)

  // Run the search against the live doc, anchoring `current` to the first match
  // at/after the previous current position so cycling survives edits/replaces.
  const runSearch = useCallback(() => {
    if (!view) return
    const { re, error: err } = buildQuery(query, opts)
    setError(err ?? null)
    if (!re) {
      matchesRef.current = []
      currentRef.current = -1
      setCount(0)
      setCurrent(-1)
      setLinked(0)
      clearFind(view)
      return
    }
    const prevAnchor =
      currentRef.current >= 0 && matchesRef.current[currentRef.current]
        ? matchesRef.current[currentRef.current].from
        : view.state.selection.main.from
    const matches = findMatches(view.state.doc.toString(), re)
    const idx = matches.length
      ? Math.max(
          0,
          matches.findIndex((m) => m.from >= prevAnchor)
        )
      : -1
    matchesRef.current = matches
    currentRef.current = idx
    setCount(matches.length)
    setCurrent(idx)
    setLinked(linkedMatchCount(view.state, matches))
    setFind(view, matches, idx)
  }, [view, query, opts])

  // Re-search on query/opts change and on doc edits (docEpoch) while open.
  useEffect(() => {
    runSearch()
  }, [runSearch, docEpoch])

  // Focus + select the query input on open (references only a ref).
  useEffect(() => {
    queryRef.current?.focus()
    queryRef.current?.select()
  }, [])

  // Clear the highlight + return focus to the editor when the bar unmounts.
  useEffect(() => {
    return () => {
      if (view) {
        clearFind(view)
        view.focus()
      }
    }
  }, [view])

  const nav = useCallback(
    (dir: 1 | -1) => {
      if (!view || !matchesRef.current.length) return
      const i = gotoMatch(view, matchesRef.current, currentRef.current + dir)
      currentRef.current = i
      setCurrent(i)
    },
    [view]
  )

  const toggle = useCallback((key: keyof FindOpts) => {
    setOpts((o) => ({ ...o, [key]: !o[key] }))
  }, [])

  const withRepl = useCallback(
    (list: FindMatch[]): FindMatch[] => {
      const { re } = buildQuery(query, opts)
      if (!re) return list
      return list.map((m) => ({ ...m, repl: replFor(m.text, re, replacement) }))
    },
    [query, opts, replacement]
  )

  const replaceCurrent = useCallback(() => {
    if (!view) return
    const cur = matchesRef.current[currentRef.current]
    if (!cur) return
    replaceRanges(view, withRepl([cur]))
    // docEpoch bump (from the parent's updateListener) re-runs the search.
  }, [view, withRepl])

  const replaceAll = useCallback(() => {
    if (!view || !matchesRef.current.length) return
    replaceRanges(view, withRepl(matchesRef.current))
  }, [view, withRepl])

  const onQueryKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault()
        nav(e.shiftKey ? -1 : 1)
      } else if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    },
    [nav, onClose]
  )

  const onReplaceKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault()
        replaceCurrent()
      } else if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    },
    [replaceCurrent, onClose]
  )

  const showReplace = replaceMode && !readOnly
  const counterText = error
    ? "bad regex"
    : !query
      ? ""
      : count === 0
        ? "0 results"
        : `${current + 1} / ${count}`

  return (
    <div
      className={cn(
        "w-[24rem] max-w-[calc(100%-1.5rem)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg",
        "border-t-2 border-t-primary",
        className
      )}
      // Keep clicks inside the bar from stealing/altering the editor selection.
      onMouseDown={(e) => {
        if (e.target instanceof HTMLElement && e.target.tagName !== "INPUT")
          e.preventDefault()
      }}
    >
      <div className="flex items-center gap-1 p-1.5">
        <button
          type="button"
          aria-label={showReplace ? "Hide replace" : "Show replace"}
          title="Toggle replace"
          disabled={readOnly}
          onClick={() => onReplaceModeChange(!replaceMode)}
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", showReplace && "rotate-90")}
          />
        </button>
        <input
          ref={queryRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onQueryKey}
          placeholder="Find"
          spellCheck={false}
          aria-label="Find"
          className={cn(
            "min-w-0 flex-1 rounded border bg-background px-2 py-1 font-mono text-[12.5px] outline-none focus:border-ring",
            error && "border-destructive"
          )}
        />
        <Toggle label="Match case" active={opts.caseSense} onClick={() => toggle("caseSense")}>
          Aa
        </Toggle>
        <Toggle label="Whole word" active={opts.word} onClick={() => toggle("word")}>
          <span className="text-[13px] leading-none">|ab|</span>
        </Toggle>
        <Toggle label="Regular expression" active={opts.regex} onClick={() => toggle("regex")}>
          <Regex className="size-3.5" />
        </Toggle>
        <span
          className={cn(
            "w-16 shrink-0 text-center text-[11px] tabular-nums",
            error || count === 0 ? "text-destructive" : "text-muted-foreground"
          )}
          title={error ?? undefined}
        >
          {counterText}
        </span>
        <IconBtn label="Previous match (Shift+Enter)" onClick={() => nav(-1)} disabled={count === 0}>
          <ArrowUp className="size-3.5" />
        </IconBtn>
        <IconBtn label="Next match (Enter)" onClick={() => nav(1)} disabled={count === 0}>
          <ArrowDown className="size-3.5" />
        </IconBtn>
        <IconBtn label="Close (Esc)" onClick={onClose}>
          <X className="size-3.5" />
        </IconBtn>
      </div>

      {showReplace && (
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <span className="size-6 shrink-0" />
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={onReplaceKey}
            placeholder="Replace"
            spellCheck={false}
            aria-label="Replace"
            className="min-w-0 flex-1 rounded border bg-background px-2 py-1 font-mono text-[12.5px] outline-none focus:border-ring"
          />
          <IconBtn label="Replace" onClick={replaceCurrent} disabled={count === 0}>
            <Replace className="size-3.5" />
          </IconBtn>
          <IconBtn label="Replace all" onClick={replaceAll} disabled={count === 0}>
            <ReplaceAll className="size-3.5" />
          </IconBtn>
        </div>
      )}

      {showReplace && linked > 0 && (
        <div className="border-t border-dashed px-2.5 py-1.5 text-[10.5px] leading-snug text-[color:var(--flag-suspect)]">
          ⧉ {linked} {linked === 1 ? "match is" : "matches are"} inside linked
          snippets — replacing creates local edits.{" "}
          <span className="text-muted-foreground">Undo restores both.</span>
        </div>
      )}
    </div>
  )
}

function Toggle({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded border text-[11px] font-medium",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}
