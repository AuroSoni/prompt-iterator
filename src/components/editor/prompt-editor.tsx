// The Cockpit editor (Phase-0 decision: variant B) rendered inside a generic
// workspace slot. CodeMirror 6 owns the text + regions; React renders the
// chrome (outline, ribbon, inspector, status bar) from a snapshot that is
// re-read on every relevant CM update, rAF-batched.
//
// Chrome adapts to slot width via container queries: the ribbon is always
// there, the inspector appears from @3xl, the outline from @5xl.
//
// Zen X-ray (Phase-0 decision: variant D) is a focus MODE of the same view,
// not a separate editor: `pe-zen` collapses the chrome to a centered prose
// column, `pe-xray` dims prose and lifts region structure forward. Alt+Z
// toggles Zen, Alt+X toggles X-ray, Esc peels back one layer at a time.

import { useCallback, useEffect, useRef, useState } from "react"
import { Compartment, EditorState } from "@codemirror/state"
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { Lock } from "lucide-react"

import {
  addRegionEffect,
  approxTokens,
  FLAGS,
  regionAt,
  regionExtensions,
  regionInfos,
  regionsField,
  ribbonSegments,
  scrollToRegion,
  updateRegionEffect,
} from "@/lib/editor"
import type { Flag, Region, RegionInfo, RibbonSegment } from "@/lib/editor"
import { getDoc, updateDocContent } from "@/lib/library"
import { cn } from "@/lib/utils"

function flagColor(flag: Flag): string {
  return `var(--flag-${flag})`
}

// Cockpit-only CM extensions, swapped out (empty) while a slot is in Zen mode.
// A single shared Compartment tag is safe across simultaneous views — each
// reconfigure is dispatched per-view against its own state.
const modeCompartment = new Compartment()
const cockpitExtras = () => [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
]

/** Everything the React chrome needs, read from the CM state in one place. */
interface Chrome {
  regions: RegionInfo[]
  totalTokens: number
  activeRegionId: string | null
  line: number
  col: number
  segments: RibbonSegment[]
  pill: { left: number; top: number } | null
  viewport: { topPct: number; heightPct: number }
}

function readChrome(view: EditorView, host: HTMLElement): Chrome {
  const state = view.state
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.head)

  let pill: Chrome["pill"] = null
  if (!sel.empty) {
    const c = view.coordsAtPos(sel.head)
    if (c) {
      const hostRect = host.getBoundingClientRect()
      pill = {
        left: Math.max(4, Math.min(c.left - hostRect.left, hostRect.width - 130)),
        top: c.bottom - hostRect.top + 8,
      }
    }
  }

  const sd = view.scrollDOM
  const scrollHeight = sd.scrollHeight || 1
  return {
    regions: regionInfos(state),
    totalTokens: approxTokens(state.doc.toString()),
    activeRegionId: regionAt(state, sel.head)?.id ?? null,
    line: line.number,
    col: sel.head - line.from + 1,
    segments: ribbonSegments(state),
    pill,
    viewport: {
      topPct: (sd.scrollTop / scrollHeight) * 100,
      heightPct: Math.max(4, (sd.clientHeight / scrollHeight) * 100),
    },
  }
}

export function PromptEditor({ docId }: { docId: string }) {
  const doc = getDoc(docId)
  const hostRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [chrome, setChrome] = useState<Chrome | null>(null)
  const [zen, setZen] = useState(false)
  const [xray, setXray] = useState(false)
  // Zen ribbon is scroll-reactive: hot while scrolling, fades shortly after.
  const [ribbonHot, setRibbonHot] = useState(false)
  // Refs mirror mode state for CM keymap handlers created once at mount.
  const zenRef = useRef(zen)
  const xrayRef = useRef(xray)

  useEffect(() => {
    const mount = mountRef.current
    const host = hostRef.current
    const initial = getDoc(docId)
    if (!mount || !host || !initial) return

    let raf = 0
    const schedule = (view: EditorView) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setChrome(readChrome(view, host))
      })
    }

    const view = new EditorView({
      parent: mount,
      state: EditorState.create({
        doc: initial.body,
        extensions: [
          history(),
          // Mode keys sit above defaultKeymap so Esc can exit a mode before
          // simplifySelection sees it. Handlers read refs: they outlive
          // renders but must observe current mode state.
          keymap.of([
            {
              key: "Alt-z",
              run: () => {
                setZen((z) => !z)
                return true
              },
            },
            {
              key: "Alt-x",
              run: () => {
                if (zenRef.current) {
                  setXray((x) => !x)
                } else {
                  setZen(true)
                  setXray(true)
                }
                return true
              },
            },
            {
              key: "Escape",
              run: () => {
                if (xrayRef.current) {
                  setXray(false)
                  return true
                }
                if (zenRef.current) {
                  setZen(false)
                  return true
                }
                return false
              },
            },
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          modeCompartment.of(cockpitExtras()),
          EditorView.lineWrapping,
          EditorState.readOnly.of(initial.readOnly),
          EditorView.editable.of(!initial.readOnly),
          regionExtensions(initial.regions),
          EditorView.updateListener.of((u) => {
            const hasEffects = u.transactions.some((t) => t.effects.length > 0)
            if (u.docChanged || hasEffects) {
              updateDocContent(
                docId,
                u.state.doc.toString(),
                u.state.field(regionsField)
              )
            }
            if (u.docChanged || u.geometryChanged || u.selectionSet || hasEffects) {
              schedule(u.view)
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    let ribbonFade = 0
    const onScroll = () => {
      schedule(view)
      if (zenRef.current) {
        setRibbonHot(true)
        window.clearTimeout(ribbonFade)
        ribbonFade = window.setTimeout(() => setRibbonHot(false), 900)
      }
    }
    view.scrollDOM.addEventListener("scroll", onScroll)
    setChrome(readChrome(view, host))

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(ribbonFade)
      viewRef.current = null
      view.destroy()
    }
  }, [docId])

  // Mode switches reconfigure the SAME view — cursor, undo history, scroll
  // position, and regions all survive the toggle.
  const zenInitRef = useRef(true)
  useEffect(() => {
    zenRef.current = zen
    if (!zen) setXray(false) // leaving Zen always drops X-ray with it
    if (zenInitRef.current) {
      zenInitRef.current = false
      return
    }
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: [
        modeCompartment.reconfigure(zen ? [] : cockpitExtras()),
        // The column re-centers on toggle; keep the cursor in view.
        EditorView.scrollIntoView(view.state.selection.main.head, {
          y: "center",
        }),
      ],
    })
  }, [zen])

  useEffect(() => {
    xrayRef.current = xray
  }, [xray])

  const jumpTo = useCallback((r: Region) => {
    const view = viewRef.current
    if (view) scrollToRegion(view, r)
  }, [])

  const patchRegion = useCallback((id: string, patch: Partial<Region>) => {
    viewRef.current?.dispatch({ effects: updateRegionEffect.of({ id, patch }) })
  }, [])

  const markSelection = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    if (from === to) return
    view.dispatch({
      effects: addRegionEffect.of({
        id: `r${Date.now().toString(36)}`,
        name: "new-region",
        flag: "ok",
        note: "",
        from,
        to,
      }),
      selection: { anchor: to },
    })
    view.focus()
  }, [])

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Document not found.
      </div>
    )
  }

  const activeRegion =
    chrome?.regions.find((r) => r.id === chrome.activeRegionId) ?? null

  return (
    <div
      className={cn(
        "prompt-editor @container flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground",
        zen && "pe-zen",
        xray && "pe-xray"
      )}
    >
      <div className="flex min-h-0 flex-1">
        {!zen && (
          <Outline
            regions={chrome?.regions ?? []}
            activeRegionId={chrome?.activeRegionId ?? null}
            onJump={jumpTo}
            className="hidden w-52 shrink-0 border-r @5xl:block"
          />
        )}

        <div ref={hostRef} className="relative min-w-0 flex-1">
          <div
            ref={mountRef}
            className={cn(
              "absolute inset-y-0 left-0",
              zen ? "right-0" : "right-[18px]"
            )}
          />
          <Ribbon
            segments={chrome?.segments ?? []}
            viewport={chrome?.viewport ?? null}
            onJump={jumpTo}
            className={cn(
              zen &&
                "top-12 border-transparent bg-transparent transition-opacity duration-500",
              zen && !(xray || ribbonHot) && "pointer-events-none opacity-0"
            )}
          />
          {zen && (
            <ZenControls
              tokens={chrome?.totalTokens ?? 0}
              xray={xray}
              readOnly={doc.readOnly}
              onXray={() => setXray((x) => !x)}
              onExit={() => setZen(false)}
            />
          )}
          {zen && (
            <div className="pointer-events-none absolute right-5 bottom-2 z-20 text-[10px] tracking-wide text-muted-foreground/60">
              Alt+X x-ray · Esc exit
            </div>
          )}
          {!doc.readOnly && chrome?.pill && (
            <button
              type="button"
              className="absolute z-10 rounded-md border border-ring bg-card px-2.5 py-1 text-[11px] font-medium shadow-sm hover:bg-accent"
              style={{ left: chrome.pill.left, top: chrome.pill.top }}
              // mousedown, not click: keep the editor selection alive.
              onMouseDown={(e) => {
                e.preventDefault()
                markSelection()
              }}
            >
              + Mark region
            </button>
          )}
        </div>

        {!zen && (
          <Inspector
            region={activeRegion}
            readOnly={doc.readOnly}
            onPatch={patchRegion}
            className="hidden w-60 shrink-0 border-l @3xl:block"
          />
        )}
      </div>

      {!zen && (
        <StatusBar
          chrome={chrome}
          readOnly={doc.readOnly}
          onZen={() => setZen(true)}
        />
      )}
    </div>
  )
}

// ---- Zen controls --------------------------------------------------------

function ZenControls({
  tokens,
  xray,
  readOnly,
  onXray,
  onExit,
}: {
  tokens: number
  xray: boolean
  readOnly: boolean
  onXray: () => void
  onExit: () => void
}) {
  return (
    <div
      className={cn(
        "absolute top-3 right-5 z-20 flex items-center gap-2.5 transition-opacity duration-300",
        // Controls rest at low opacity; they wake on hover or under X-ray.
        xray ? "opacity-100" : "opacity-40 hover:opacity-100"
      )}
    >
      <span className="text-[11px] text-muted-foreground tabular-nums">
        ≈ {tokens.toLocaleString()} tok
      </span>
      {readOnly && <Lock className="size-3 text-muted-foreground" />}
      <button
        type="button"
        title="Toggle X-ray (Alt+X)"
        // mousedown-preventDefault keeps editor focus; click still fires.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onXray}
        className={cn(
          "rounded-full border px-3 py-1 text-[10px] font-medium tracking-[0.12em] uppercase",
          xray
            ? "border-primary bg-primary text-primary-foreground"
            : "text-muted-foreground hover:border-ring hover:text-foreground"
        )}
      >
        ✦ x-ray
      </button>
      <button
        type="button"
        title="Exit Zen (Esc)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onExit}
        className="rounded-full border px-3 py-1 text-[10px] tracking-[0.12em] text-muted-foreground uppercase hover:border-ring hover:text-foreground"
      >
        exit
      </button>
    </div>
  )
}

// ---- Outline -------------------------------------------------------------

function Outline({
  regions,
  activeRegionId,
  onJump,
  className,
}: {
  regions: RegionInfo[]
  activeRegionId: string | null
  onJump: (r: Region) => void
  className?: string
}) {
  return (
    <nav className={cn("overflow-y-auto py-3", className)}>
      <h3 className="px-3 pb-2 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
        REGIONS
      </h3>
      {regions.length === 0 && (
        <p className="px-3 text-xs leading-relaxed text-muted-foreground">
          No regions yet.
        </p>
      )}
      {regions.map((r) => {
        const active = r.id === activeRegionId
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onJump(r)}
            className={cn(
              "block w-full border-l-2 px-3 py-1.5 text-left",
              active ? "bg-accent/60" : "border-l-transparent hover:bg-accent/40"
            )}
            style={active ? { borderLeftColor: flagColor(r.flag) } : undefined}
          >
            <span className="flex items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: flagColor(r.flag) }}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {r.name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {r.tokens}t
              </span>
            </span>
            <span className="mt-1 block h-0.5 overflow-hidden rounded bg-border">
              <span
                className="block h-full rounded"
                style={{ width: `${r.pct}%`, background: flagColor(r.flag) }}
              />
            </span>
          </button>
        )
      })}
    </nav>
  )
}

// ---- Ribbon (structure minimap) ------------------------------------------

function Ribbon({
  segments,
  viewport,
  onJump,
  className,
}: {
  segments: RibbonSegment[]
  viewport: { topPct: number; heightPct: number } | null
  onJump: (r: Region) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        // top/bottom (not inset-y) so a zen `top-12` override merges cleanly.
        "absolute top-2 right-1 bottom-2 w-2 overflow-hidden rounded-sm border bg-muted/40",
        className
      )}
    >
      {segments.map((s, i) =>
        s.region ? (
          <button
            key={s.region.id}
            type="button"
            title={s.region.name}
            onClick={() => onJump(s.region!)}
            className="block w-full opacity-80 hover:opacity-100"
            style={{ height: `${s.pct}%`, background: flagColor(s.region.flag) }}
          />
        ) : (
          <div key={`gap-${i}`} style={{ height: `${s.pct}%` }} />
        )
      )}
      {viewport && (
        <div
          className="pointer-events-none absolute inset-x-0 rounded-[2px] border border-foreground/40 bg-foreground/10"
          style={{
            top: `${viewport.topPct}%`,
            height: `${viewport.heightPct}%`,
          }}
        />
      )}
    </div>
  )
}

// ---- Inspector -----------------------------------------------------------

function Inspector({
  region,
  readOnly,
  onPatch,
  className,
}: {
  region: RegionInfo | null
  readOnly: boolean
  onPatch: (id: string, patch: Partial<Region>) => void
  className?: string
}) {
  return (
    <aside className={cn("overflow-y-auto p-4", className)}>
      <h3 className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
        INSPECTOR
      </h3>
      {!region ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Place the cursor inside a region
          {readOnly ? "." : ", or select text and mark a new one."}
        </p>
      ) : (
        // Key by region id: uncontrolled fields reset when the region changes,
        // but survive re-renders while typing (the prototype's dirty-tracking).
        <div key={region.id} className="mt-3 space-y-4">
          <input
            defaultValue={region.name}
            disabled={readOnly}
            onBlur={(e) => {
              const name = e.target.value.trim()
              if (name && name !== region.name) onPatch(region.id, { name })
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
            }}
            aria-label="Region name"
            className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 font-mono text-[13px] font-semibold focus:border-input focus:outline-none disabled:opacity-70"
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
        </div>
      )}
    </aside>
  )
}

// ---- Status bar ----------------------------------------------------------

function StatusBar({
  chrome,
  readOnly,
  onZen,
}: {
  chrome: Chrome | null
  readOnly: boolean
  onZen: () => void
}) {
  const flagCounts = FLAGS.filter((f) => f !== "ok")
    .map((f) => ({
      flag: f,
      n: chrome?.regions.filter((r) => r.flag === f).length ?? 0,
    }))
    .filter(({ n }) => n > 0)

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t bg-muted/40 px-3 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground/80 tabular-nums">
        {(chrome?.totalTokens ?? 0).toLocaleString()} tok
      </span>
      <span>{chrome?.regions.length ?? 0} regions</span>
      {flagCounts.map(({ flag, n }) => (
        <span key={flag} style={{ color: flagColor(flag) }}>
          {n} {flag}
        </span>
      ))}
      <span className="flex-1" />
      <button
        type="button"
        title="Zen focus mode (Alt+Z)"
        // mousedown-preventDefault keeps editor focus; click still fires.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onZen}
        className="hover:text-foreground"
      >
        ✦ zen
      </button>
      {readOnly && (
        <span className="inline-flex items-center gap-1">
          <Lock className="size-3" />
          read-only
        </span>
      )}
      <span className="tabular-nums">
        Ln {chrome?.line ?? 1}, Col {chrome?.col ?? 1}
      </span>
    </footer>
  )
}
