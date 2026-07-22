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
import { foldedRanges, foldGutter, foldKeymap } from "@codemirror/language"
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookmarkPlus,
  Lock,
  Trash2,
} from "lucide-react"

import {
  addRegionEffect,
  approxTokens,
  FLAGS,
  regionAt,
  regionExtensions,
  regionInfos,
  regionsField,
  registerView,
  regionsOverlap,
  removeRegionEffect,
  ribbonSegments,
  scrollToRegion,
  unregisterView,
  updateRegionEffect,
} from "@/lib/editor"
import type { Flag, Region, RegionInfo, RibbonSegment } from "@/lib/editor"
import { promptFolding, restoreFolds, saveFolds } from "@/lib/fold"
import { promptLanguage } from "@/lib/language"
import {
  createSnippetFromText,
  flushPendingNow,
  getDoc,
  getSnippet,
  getSnippetBody,
  promoteSnippet,
  reportError,
  updateDocContent,
  updateSnippetFromRegion,
  useLibrary,
  useSaveState,
} from "@/lib/library"
import type { SaveState, Snippet } from "@/lib/library"
import { Button } from "@/components/ui/button"
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
  foldGutter(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
]

/** Everything the React chrome needs, read from the CM state in one place. */
interface Chrome {
  regions: RegionInfo[]
  totalTokens: number
  activeRegionId: string | null
  /** Current text of the active region — lets the Inspector detect local edits
   *  (region text ≠ snippet canonical) without reading the view ref in render. */
  activeRegionText: string
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
  const active = regionAt(state, sel.head)
  return {
    regions: regionInfos(state),
    totalTokens: approxTokens(state.doc.toString()),
    activeRegionId: active?.id ?? null,
    activeRegionText: active
      ? state.doc.sliceString(active.from, active.to)
      : "",
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
  const saveState = useSaveState(docId)
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
              // Force-save: skip the debounce and flush now (DB when
              // persistent, localStorage otherwise). Returning true makes CM
              // preventDefault, so the browser Save dialog never opens.
              key: "Mod-s",
              run: () => {
                void flushPendingNow()
                return true
              },
            },
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
          keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
          modeCompartment.of(cockpitExtras()),
          EditorView.lineWrapping,
          EditorState.readOnly.of(initial.readOnly),
          EditorView.editable.of(!initial.readOnly),
          promptLanguage(),
          promptFolding(),
          regionExtensions(initial.regions),
          EditorView.updateListener.of((u) => {
            const hasEffects = u.transactions.some((t) => t.effects.length > 0)
            // The store write triggers on doc edits and REGION effects only.
            // Triggering on any effect would turn fold/unfold gestures (and
            // zen reconfigures, scrollIntoView) into no-op Supabase UPDATEs.
            const hasRegionEffects = u.transactions.some((t) =>
              t.effects.some(
                (e) =>
                  e.is(addRegionEffect) ||
                  e.is(updateRegionEffect) ||
                  e.is(removeRegionEffect)
              )
            )
            if (u.docChanged || hasRegionEffects) {
              updateDocContent(
                docId,
                u.state.doc.toString(),
                u.state.field(regionsField)
              )
            }
            // Fold changes are view-state: persisted locally, never to the DB.
            if (foldedRanges(u.state) !== foldedRanges(u.startState)) {
              saveFolds(docId, u.state)
            }
            if (u.docChanged || u.geometryChanged || u.selectionSet || hasEffects) {
              schedule(u.view)
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    registerView(docId, view)
    restoreFolds(view, docId)
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
      unregisterView(docId, view)
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

  // Drop a region's annotation (name/flag/note); the prose it covered stays.
  const removeRegion = useCallback((id: string) => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: removeRegionEffect.of(id) })
    view.focus()
  }, [])

  // Mark a span as a region. Region-first, link-on-resolve: the region is painted
  // synchronously (so it maps through any edits during the await), then — inside a
  // prompt — a snippet is created and its id attached. Marking inside a snippet
  // stays a plain local region (flat v1). Failure leaves it unlinked.
  const markSelection = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    if (from === to) return
    // Overlapping regions make "which snippet owns this text" ambiguous.
    if (regionsOverlap(view.state.field(regionsField), from, to)) return
    const id = `r${Date.now().toString(36)}`
    const text = view.state.doc.sliceString(from, to)
    view.dispatch({
      effects: addRegionEffect.of({
        id,
        name: "new-region",
        flag: "ok",
        note: "",
        from,
        to,
      }),
      selection: { anchor: to },
    })
    view.focus()
    if (getDoc(docId)?.kind !== "prompt") return
    try {
      const { id: snippetId, version } = await createSnippetFromText(
        "new-region",
        text
      )
      viewRef.current?.dispatch({
        effects: updateRegionEffect.of({
          id,
          patch: { snippetId, syncedVersion: version },
        }),
      })
    } catch (e) {
      reportError(
        e instanceof Error ? e.message : "Couldn't create the snippet."
      )
    }
  }, [docId])

  // Pull: replace the region's text with the snippet's canonical body and sync
  // its version. One transaction — the doc change collapses the old span, and the
  // updateRegionEffect restores explicit bounds (see regionsField's filter order).
  const pullRegion = useCallback((region: Region) => {
    const view = viewRef.current
    if (!view || !region.snippetId) return
    const snip = getSnippet(region.snippetId)
    const canonical = getSnippetBody(region.snippetId)
    if (!snip || canonical === undefined || canonical.length === 0) return
    const cur = view.state
      .field(regionsField)
      .find((r) => r.id === region.id)
    if (!cur) return
    view.dispatch({
      changes: { from: cur.from, to: cur.to, insert: canonical },
      effects: updateRegionEffect.of({
        id: region.id,
        patch: {
          from: cur.from,
          to: cur.from + canonical.length,
          syncedVersion: snip.version,
        },
      }),
    })
    view.focus()
  }, [])

  // Push: make the snippet's canonical body this region's current text (bumps the
  // snippet version, so other references go stale), then sync this region to it.
  const pushRegion = useCallback(async (region: Region) => {
    const view = viewRef.current
    if (!view || !region.snippetId) return
    const cur = view.state
      .field(regionsField)
      .find((r) => r.id === region.id)
    if (!cur) return
    const text = view.state.doc.sliceString(cur.from, cur.to)
    try {
      const version = await updateSnippetFromRegion(region.snippetId, text)
      viewRef.current?.dispatch({
        effects: updateRegionEffect.of({
          id: region.id,
          patch: { syncedVersion: version },
        }),
      })
    } catch (e) {
      reportError(
        e instanceof Error ? e.message : "Couldn't update the snippet."
      )
    }
  }, [])

  const promoteRegion = useCallback(async (region: Region) => {
    if (!region.snippetId) return
    try {
      await promoteSnippet(region.snippetId)
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Couldn't promote.")
    }
  }, [])

  // Make an unlinked region reusable: create a snippet from its text and link it.
  const makeReusable = useCallback(async (region: Region) => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state
      .field(regionsField)
      .find((r) => r.id === region.id)
    if (!cur) return
    const text = view.state.doc.sliceString(cur.from, cur.to)
    try {
      const { id: snippetId, version } = await createSnippetFromText(
        region.name,
        text
      )
      viewRef.current?.dispatch({
        effects: updateRegionEffect.of({
          id: region.id,
          patch: { snippetId, syncedVersion: version },
        }),
      })
    } catch (e) {
      reportError(
        e instanceof Error ? e.message : "Couldn't create the snippet."
      )
    }
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
            regionText={chrome?.activeRegionText ?? ""}
            readOnly={doc.readOnly}
            onPatch={patchRegion}
            onRemove={removeRegion}
            onPull={pullRegion}
            onPush={pushRegion}
            onPromote={promoteRegion}
            onMakeReusable={makeReusable}
            className="hidden w-60 shrink-0 border-l @3xl:block"
          />
        )}
      </div>

      {!zen && (
        <StatusBar
          chrome={chrome}
          saveState={saveState}
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

function Inspector({
  region,
  regionText,
  readOnly,
  onPatch,
  onRemove,
  onPull,
  onPush,
  onPromote,
  onMakeReusable,
  className,
}: {
  region: RegionInfo | null
  regionText: string
  readOnly: boolean
  onPatch: (id: string, patch: Partial<Region>) => void
  onRemove: (id: string) => void
  onPull: (region: Region) => void
  onPush: (region: Region) => void
  onPromote: (region: Region) => void
  onMakeReusable: (region: Region) => void
  className?: string
}) {
  // Subscribe so the link panel reflects live snippet version/usage counts.
  const lib = useLibrary()
  const snippet =
    region?.snippetId != null
      ? lib.snippets.find((s) => s.id === region.snippetId)
      : undefined

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

          <SnippetLink
            region={region}
            regionText={regionText}
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

          {/* Removing the annotation leaves the prose it covered in place. */}
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
      )}
    </aside>
  )
}

// ---- Status bar ----------------------------------------------------------

// Indicator copy + color per save state; "saved" stays quiet (muted, no dot).
const SAVE_BADGES: Record<SaveState, { label: string; color?: string }> = {
  saved: { label: "saved" },
  dirty: { label: "unsaved", color: "var(--flag-suspect)" },
  saving: { label: "saving…" },
  error: { label: "save failed — retrying", color: "var(--flag-stale)" },
  local: { label: "saved locally", color: "var(--flag-revisit)" },
}

function StatusBar({
  chrome,
  saveState,
  readOnly,
  onZen,
}: {
  chrome: Chrome | null
  saveState: SaveState
  readOnly: boolean
  onZen: () => void
}) {
  const flagCounts = FLAGS.filter((f) => f !== "ok")
    .map((f) => ({
      flag: f,
      n: chrome?.regions.filter((r) => r.flag === f).length ?? 0,
    }))
    .filter(({ n }) => n > 0)
  const badge = SAVE_BADGES[saveState]

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
      {!readOnly && (
        <span
          className="inline-flex items-center gap-1.5"
          style={badge.color ? { color: badge.color } : undefined}
        >
          {badge.color && (
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: badge.color }}
            />
          )}
          {badge.label}
        </span>
      )}
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
