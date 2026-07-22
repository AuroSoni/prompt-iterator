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
import { Lock, PanelLeft, PanelRight } from "lucide-react"

import {
  addRegionEffect,
  approxTokens,
  FLAGS,
  flagColor,
  regionAt,
  regionExtensions,
  regionInfos,
  regionsField,
  registerView,
  regionsOverlap,
  removeRegionEffect,
  ribbonMarks,
  scrollToRegion,
  unregisterView,
  updateRegionEffect,
} from "@/lib/editor"
import type { Region, RegionInfo, RibbonMark } from "@/lib/editor"
import {
  promptFolding,
  restoreFolds,
  revealPos,
  saveFolds,
  unfoldAt,
} from "@/lib/fold"
import { promptLanguage } from "@/lib/language"
import { outlineNodeAt, outlineNodes } from "@/lib/outline"
import type { OutlineNode } from "@/lib/outline"
import {
  createSnippetFromText,
  flushPendingNow,
  getDoc,
  getSnippet,
  getSnippetBody,
  listSnippets,
  promoteSnippet,
  reportError,
  updateDocContent,
  updateSnippetFromRegion,
  updateSnippetNote,
  useSaveState,
} from "@/lib/library"
import type { SaveState } from "@/lib/library"
import {
  dismissSnippetMatch,
  effectiveDismissals,
  findSnippetMatches,
} from "@/lib/snippet-match"
import type { MatchCandidate } from "@/lib/snippet-match"
import { findExtension } from "@/lib/find"
import { regionHover } from "@/lib/hover"
import { UI_LIMITS, setUiPrefs, useUiPrefs } from "@/lib/ui-prefs"
import { FindBar } from "@/components/editor/find-bar"
import { Inspector } from "@/components/editor/inspector"
import { RegionPopover } from "@/components/editor/region-popover"
import { ResizeHandle } from "@/components/ui/resize-handle"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// Cockpit-only CM extensions, swapped out (empty) while a slot is in Zen mode.
// A single shared Compartment tag is safe across simultaneous views — each
// reconfigure is dispatched per-view against its own state.
const modeCompartment = new Compartment()
const cockpitExtras = () => [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
]

// The fold gutter is always-on (NOT in the mode compartment): zen keeps a
// fold affordance, restyled quiet via .pe-zen CSS. markerDOM emits classed
// spans because CM's default markers carry no open/closed class for CSS to
// distinguish; the glyphs match CM's defaults so cockpit looks unchanged.
const promptFoldGutter = foldGutter({
  markerDOM: (open) => {
    const m = document.createElement("span")
    m.className = open ? "pe-fold pe-fold-open" : "pe-fold pe-fold-closed"
    m.textContent = open ? "⌄" : "›"
    return m
  },
})

/** Scan debounce — longer than the store's 500ms flush, so the scan never
 *  fires mid-typing-burst. */
const SCAN_DEBOUNCE_MS = 800

/** One synchronous auto-match pass over a live prompt view: find unmarked
 *  spans exactly equal to a snippet's canonical body and mark them as linked,
 *  born-synced regions. One dispatch = one transaction = one updateDocContent
 *  (linkSig changes → recomputeUsage → usedBy climbs, which is exactly how a
 *  twice-pasted mark-created snippet surfaces in the sidebar). Idempotent via
 *  the overlap guard, so StrictMode double-mounts are safe; the scan's own
 *  effects-only dispatch never reschedules itself (scan runs on docChanged
 *  only), so there is no loop. */
function runSnippetScan(docId: string, view: EditorView): void {
  const doc = getDoc(docId)
  if (!doc || doc.kind !== "prompt" || doc.readOnly) return
  const body = view.state.doc.toString()
  const candidates: MatchCandidate[] = listSnippets().flatMap((s) => {
    const canonical = getSnippetBody(s.id)
    return canonical
      ? [{ snippetId: s.id, name: s.name, version: s.version, body: canonical }]
      : []
  })
  const skip = effectiveDismissals(docId, body, candidates)
  const matches = findSnippetMatches(
    body,
    view.state.field(regionsField),
    candidates.filter((c) => !skip.has(c.snippetId))
  )
  if (matches.length === 0) return
  // The -i suffix avoids the id collision markSelection's bare timestamp
  // pattern would hit on a multi-match batch.
  const stamp = Date.now().toString(36)
  view.dispatch({
    effects: matches.map((m, i) =>
      addRegionEffect.of({ id: `r${stamp}-${i}`, flag: "ok", note: "", ...m })
    ),
  })
}

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
  /** Raw caret position — drives the outline's active-node highlight. */
  caret: number
  outline: OutlineNode[]
  marks: RibbonMark[]
  pill: { left: number; top: number } | null
  /** When the selection touches an existing region, the pill flips from
   *  "mark" to "edit" and targets this region. */
  pillEdit: { id: string; name: string } | null
  viewport: { topPct: number; heightPct: number }
}

function readChrome(view: EditorView, host: HTMLElement): Chrome {
  const state = view.state
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.head)
  const active = regionAt(state, sel.head)

  let pill: Chrome["pill"] = null
  let pillEdit: Chrome["pillEdit"] = null
  if (!sel.empty) {
    const c = view.coordsAtPos(sel.head)
    if (c) {
      const hostRect = host.getBoundingClientRect()
      pill = {
        left: Math.max(4, Math.min(c.left - hostRect.left, hostRect.width - 130)),
        top: c.bottom - hostRect.top + 8,
      }
    }
    // Head-in-region wins; otherwise any overlapped region is the edit target
    // (marking over it is forbidden anyway — see regionsOverlap).
    const hit =
      active ??
      state
        .field(regionsField)
        .find((r) => sel.from < r.to && sel.to > r.from) ??
      null
    if (hit) pillEdit = { id: hit.id, name: hit.name }
  }

  const sd = view.scrollDOM
  const scrollHeight = sd.scrollHeight || 1
  return {
    regions: regionInfos(state),
    totalTokens: approxTokens(state.doc.toString()),
    activeRegionId: active?.id ?? null,
    activeRegionText: active
      ? state.doc.sliceString(active.from, active.to)
      : "",
    line: line.number,
    col: sel.head - line.from + 1,
    caret: sel.head,
    outline: outlineNodes(state.doc),
    marks: ribbonMarks(view),
    pill,
    pillEdit,
    viewport: {
      topPct: (sd.scrollTop / scrollHeight) * 100,
      heightPct: Math.max(4, (sd.clientHeight / scrollHeight) * 100),
    },
  }
}

export function PromptEditor({ docId }: { docId: string }) {
  const doc = getDoc(docId)
  const saveState = useSaveState(docId)
  const { outlineWidth, inspectorWidth, outlineVisible, inspectorVisible } =
    useUiPrefs()
  const hostRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // View mirrored to state so the FindBar (a React child) can dispatch against
  // it — a ref alone wouldn't re-render the bar into existence.
  const [view, setView] = useState<EditorView | null>(null)
  const [chrome, setChrome] = useState<Chrome | null>(null)
  const [zen, setZen] = useState(false)
  const [xray, setXray] = useState(false)
  // Find bar: open/replace-mode + a docEpoch bumped on doc edits (only while
  // open) that drives the bar's re-search.
  const [findOpen, setFindOpen] = useState(false)
  const [findReplace, setFindReplace] = useState(false)
  const [docEpoch, setDocEpoch] = useState(0)
  // Region popover: target region id + frozen open-time anchor coords
  // (host-relative). Coords are frozen so the popover doesn't chase the caret.
  const [popover, setPopover] = useState<{
    id: string
    left: number
    top: number
  } | null>(null)
  // Zen ribbon is scroll-reactive: hot while scrolling, fades shortly after.
  const [ribbonHot, setRibbonHot] = useState(false)
  // Refs mirror mode state for CM keymap handlers created once at mount.
  const zenRef = useRef(zen)
  const xrayRef = useRef(xray)
  const findOpenRef = useRef(findOpen)
  const popoverRef = useRef(popover)
  const popoverOpenedAt = useRef(0)
  const openPopoverRef = useRef<() => boolean>(() => false)

  useEffect(() => {
    const mount = mountRef.current
    const host = hostRef.current
    const initial = getDoc(docId)
    if (!mount || !host || !initial) return

    let raf = 0
    let scanTimer = 0
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
              // Ctrl+F opens find; Ctrl+H opens find+replace (find-only when
              // the doc is read-only). Both unbound by default in this app.
              key: "Mod-f",
              run: () => {
                setFindReplace(false)
                setFindOpen(true)
                return true
              },
            },
            {
              key: "Mod-h",
              run: () => {
                setFindReplace(!getDoc(docId)?.readOnly)
                setFindOpen(true)
                return true
              },
            },
            {
              // Ctrl+M: annotate at the caret — edit the region under it,
              // or mark the selection and open the popover on it.
              key: "Mod-m",
              run: () => openPopoverRef.current(),
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
                // Close the find bar first, then peel modes.
                if (findOpenRef.current) {
                  setFindOpen(false)
                  return true
                }
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
          // After the compartment: gutters render in extension order, so line
          // numbers stay left of the fold gutter in cockpit mode.
          promptFoldGutter,
          EditorView.lineWrapping,
          EditorState.readOnly.of(initial.readOnly),
          EditorView.editable.of(!initial.readOnly),
          promptLanguage(),
          promptFolding(),
          regionExtensions(initial.regions),
          // After regions so find marks nest inside region tints (find bg on
          // top); current-match is opaque and wins regardless.
          findExtension(),
          regionHover(),
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
            // Auto-match runs on TEXT changes only — the scan's own
            // effects-only dispatch can't reschedule itself (no loop).
            if (u.docChanged) {
              window.clearTimeout(scanTimer)
              scanTimer = window.setTimeout(
                () => runSnippetScan(docId, u.view),
                SCAN_DEBOUNCE_MS
              )
            }
            // Drive the find bar's re-search after edits/replaces. Guarded on
            // findOpenRef so closed-bar typing adds no renders.
            if (u.docChanged && findOpenRef.current) {
              setDocEpoch((e) => e + 1)
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    setView(view)
    // Close any find bar / region popover left open from a previous doc.
    setFindOpen(false)
    setPopover(null)
    registerView(docId, view)
    restoreFolds(view, docId)
    // Scan on open: content that arrived while this prompt was closed (or
    // before this feature shipped) gets marked the moment it's looked at.
    runSnippetScan(docId, view)
    let ribbonFade = 0
    const onScroll = () => {
      schedule(view)
      // The popover anchor is frozen in host coords; scrolling moves the text
      // out from under it, so close. Grace period: opening can itself nudge
      // the scroll position.
      if (popoverRef.current && Date.now() - popoverOpenedAt.current > 300) {
        setPopover(null)
      }
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
      window.clearTimeout(scanTimer)
      window.clearTimeout(ribbonFade)
      unregisterView(docId, view)
      viewRef.current = null
      setView(null)
      view.destroy()
    }
  }, [docId])

  // Mirror find-open into a ref for the CM Escape handler (created once at
  // mount, so it can't read the live state directly).
  useEffect(() => {
    findOpenRef.current = findOpen
  }, [findOpen])

  useEffect(() => {
    popoverRef.current = popover
    if (popover) popoverOpenedAt.current = Date.now()
  }, [popover])

  // Close the popover if its region vanishes underneath it (undo, remove).
  useEffect(() => {
    if (popover && chrome && !chrome.regions.some((r) => r.id === popover.id)) {
      setPopover(null)
    }
  }, [popover, chrome])

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
    if (!view) return
    // The region may sit inside a collapsed fold (ribbon/list clicks) —
    // unfold first so the start-anchored scroll lands on visible text.
    unfoldAt(view, r.from)
    scrollToRegion(view, r)
  }, [])

  // Outline navigation: unfold if hidden, center, focus.
  const revealAt = useCallback((pos: number) => {
    const view = viewRef.current
    if (view) revealPos(view, pos)
  }, [])

  const patchRegion = useCallback((id: string, patch: Partial<Region>) => {
    viewRef.current?.dispatch({ effects: updateRegionEffect.of({ id, patch }) })
  }, [])

  // Drop a region's annotation (name/flag/note); the prose it covered stays.
  const removeRegion = useCallback(
    (id: string) => {
      const view = viewRef.current
      if (!view) return
      // Removing a LINKED region in a prompt is a "stop marking this snippet
      // here" signal — without the dismissal the auto-match scan would re-mark
      // the still-matching text within a second. Hand-marked regions count
      // too: their text equals the canonical by construction.
      const region = view.state.field(regionsField).find((r) => r.id === id)
      if (region?.snippetId && getDoc(docId)?.kind === "prompt") {
        const snip = getSnippet(region.snippetId)
        if (snip) dismissSnippetMatch(docId, region.snippetId, snip.version)
      }
      view.dispatch({ effects: removeRegionEffect.of(id) })
      view.focus()
    },
    [docId]
  )

  // Mark a span as a region. Region-first, link-on-resolve: the region is painted
  // synchronously (so it maps through any edits during the await), then — inside a
  // prompt — a snippet is created and its id attached. Marking inside a snippet
  // stays a plain local region (flat v1). Failure leaves it unlinked.
  // Returns the new region's id synchronously (the popover opens on it while
  // the snippet link resolves in the background).
  const markSelection = useCallback((): string | null => {
    const view = viewRef.current
    if (!view) return null
    const { from, to } = view.state.selection.main
    if (from === to) return null
    // Overlapping regions make "which snippet owns this text" ambiguous.
    if (regionsOverlap(view.state.field(regionsField), from, to)) return null
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
    if (getDoc(docId)?.kind === "prompt") {
      void (async () => {
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
      })()
    }
    return id
  }, [docId])

  // Open the mark/edit popover at the caret: an existing region under the
  // head (or overlapped by the selection) is edited; a plain selection is
  // marked first, then annotated. Always returns true — it doubles as the
  // Mod-m keymap handler and must consume the keystroke either way.
  const openRegionPopover = useCallback((): boolean => {
    const view = viewRef.current
    const host = hostRef.current
    if (!view || !host || getDoc(docId)?.readOnly) return true
    const sel = view.state.selection.main
    const hit =
      regionAt(view.state, sel.head) ??
      view.state
        .field(regionsField)
        .find((r) => sel.from < r.to && sel.to > r.from) ??
      null
    let id = hit?.id ?? null
    if (!id) {
      if (sel.empty) return true
      id = markSelection()
      if (!id) return true
    }
    const c = view.coordsAtPos(sel.head)
    if (!c) return true
    const hostRect = host.getBoundingClientRect()
    setPopover({
      id,
      left: Math.max(4, Math.min(c.left - hostRect.left, hostRect.width - 130)),
      top: c.bottom - hostRect.top + 8,
    })
    return true
  }, [docId, markSelection])

  useEffect(() => {
    openPopoverRef.current = openRegionPopover
  }, [openRegionPopover])

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

  // Commit a snippet's own note (blur-commit from the SnippetDocPanel).
  const updateNote = useCallback(async (snippetId: string, note: string) => {
    try {
      await updateSnippetNote(snippetId, note)
    } catch (e) {
      reportError(
        e instanceof Error ? e.message : "Couldn't save the snippet note."
      )
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

  const popoverRegion = popover
    ? (chrome?.regions.find((r) => r.id === popover.id) ?? null)
    : null

  return (
    <div
      className={cn(
        "prompt-editor @container flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground",
        zen && "pe-zen",
        xray && "pe-xray"
      )}
    >
      <div className="flex min-h-0 flex-1">
        {!zen && outlineVisible && (
          <>
            <Outline
              nodes={chrome?.outline ?? []}
              caret={chrome?.caret ?? 0}
              onReveal={revealAt}
              className="hidden shrink-0 border-r @5xl:block"
              // maxWidth mirrors the handle's maxFraction: a stored-wide pane
              // can't squeeze the editor when the slot narrows.
              style={{ width: outlineWidth, maxWidth: "35%" }}
            />
            <ResizeHandle
              edge="end"
              value={outlineWidth}
              min={UI_LIMITS.outlineWidth.min}
              max={UI_LIMITS.outlineWidth.max}
              maxFraction={0.35}
              defaultValue={UI_LIMITS.outlineWidth.def}
              onChange={(w, commit) =>
                setUiPrefs({ outlineWidth: w }, { persist: commit })
              }
              label="Resize regions pane"
              className="-mx-0.5 hidden @5xl:block"
            />
          </>
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
            marks={chrome?.marks ?? []}
            viewport={chrome?.viewport ?? null}
            onJump={jumpTo}
            container={hostRef.current}
            className={cn(
              zen &&
                "top-12 border-transparent bg-transparent transition-opacity duration-500",
              zen && !(xray || ribbonHot) && "pointer-events-none opacity-0"
            )}
          />
          {findOpen && (
            <FindBar
              view={view}
              replaceMode={findReplace}
              readOnly={doc.readOnly}
              docEpoch={docEpoch}
              onClose={() => setFindOpen(false)}
              onReplaceModeChange={setFindReplace}
              className={cn("absolute top-2 z-30", zen ? "right-3" : "right-6")}
            />
          )}
          {/* ZenControls yield the top-right corner to the find bar. */}
          {zen && !findOpen && (
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
          {!doc.readOnly && chrome?.pill && !popover && (
            <button
              type="button"
              className="absolute z-10 rounded-md border border-ring bg-card px-2.5 py-1 text-[11px] font-medium shadow-sm hover:bg-accent"
              style={{ left: chrome.pill.left, top: chrome.pill.top }}
              // mousedown, not click: keep the editor selection alive.
              onMouseDown={(e) => {
                e.preventDefault()
                openRegionPopover()
              }}
            >
              {chrome.pillEdit ? (
                <span className="flex max-w-44 items-center gap-1">
                  ✎
                  <span className="truncate font-mono">
                    {chrome.pillEdit.name}
                  </span>
                </span>
              ) : (
                "+ Mark region"
              )}
            </button>
          )}
          {popover && popoverRegion && (
            <RegionPopover
              key={popover.id}
              region={popoverRegion}
              anchor={popover}
              container={hostRef.current}
              onPatch={patchRegion}
              onRemove={removeRegion}
              onClose={() => setPopover(null)}
            />
          )}
        </div>

        {!zen && inspectorVisible && (
          <>
            <ResizeHandle
              edge="start"
              value={inspectorWidth}
              min={UI_LIMITS.inspectorWidth.min}
              max={UI_LIMITS.inspectorWidth.max}
              maxFraction={0.4}
              defaultValue={UI_LIMITS.inspectorWidth.def}
              onChange={(w, commit) =>
                setUiPrefs({ inspectorWidth: w }, { persist: commit })
              }
              label="Resize inspector pane"
              className="-mx-0.5 hidden @3xl:block"
            />
            <Inspector
              regions={chrome?.regions ?? []}
              activeRegionId={chrome?.activeRegionId ?? null}
              activeRegionText={chrome?.activeRegionText ?? ""}
              docId={docId}
              docKind={doc.kind}
              readOnly={doc.readOnly}
              onJump={jumpTo}
              onPatch={patchRegion}
              onRemove={removeRegion}
              onPull={pullRegion}
              onPush={pushRegion}
              onPromote={promoteRegion}
              onMakeReusable={makeReusable}
              onUpdateSnippetNote={updateNote}
              className="hidden shrink-0 border-l @3xl:block"
              style={{ width: inspectorWidth, maxWidth: "40%" }}
            />
          </>
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

// The prompt's content structure — markdown headings + XML tags as one nested
// tree (see @/lib/outline). Regions live in the Inspector; this pane is about
// the SHAPE of the document.
function Outline({
  nodes,
  caret,
  onReveal,
  className,
  style,
}: {
  nodes: OutlineNode[]
  caret: number
  onReveal: (pos: number) => void
  className?: string
  style?: React.CSSProperties
}) {
  const active = outlineNodeAt(nodes, caret)
  const rows: { node: OutlineNode; depth: number }[] = []
  const walk = (ns: OutlineNode[], depth: number) => {
    for (const n of ns) {
      rows.push({ node: n, depth })
      walk(n.children, depth + 1)
    }
  }
  walk(nodes, 0)

  return (
    <nav className={cn("overflow-y-auto py-3", className)} style={style}>
      <h3 className="px-3 pb-2 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
        OUTLINE
      </h3>
      {rows.length === 0 && (
        <p className="px-3 text-xs leading-relaxed text-muted-foreground">
          No structure detected.
        </p>
      )}
      {rows.map(({ node, depth }) => {
        const isActive = node === active
        return (
          <button
            key={`${node.from}-${node.kind}-${node.label}`}
            type="button"
            title={node.label}
            onClick={() => onReveal(node.from)}
            className={cn(
              "block w-full truncate border-l-2 py-1 pr-2 text-left text-xs",
              isActive
                ? "border-l-primary bg-accent/60"
                : "border-l-transparent hover:bg-accent/40",
              node.kind === "tag"
                ? "font-mono text-[11px]"
                : node.level <= 2 && "font-medium"
            )}
            style={{ paddingLeft: 12 + depth * 12 }}
          >
            {node.kind === "tag" ? `<${node.label}>` : node.label}
          </button>
        )
      })}
    </nav>
  )
}

// ---- Ribbon (structure minimap) ------------------------------------------

function Ribbon({
  marks,
  viewport,
  onJump,
  container,
  className,
}: {
  marks: RibbonMark[]
  viewport: { topPct: number; heightPct: number } | null
  onJump: (r: Region) => void
  /** Tooltip portal target (the editor container, for scoped CSS vars). */
  container: HTMLElement | null
  className?: string
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          // top/bottom (not inset-y) so a zen `top-12` override merges cleanly.
          "absolute top-2 right-1 bottom-2 w-2 overflow-hidden rounded-sm border bg-muted/40",
          className
        )}
      >
        {marks.map((m) => (
          // max() floor: a region collapsed into a fold still renders a
          // clickable sliver instead of vanishing.
          <Tooltip key={m.region.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onJump(m.region)}
                className="absolute inset-x-0 block opacity-80 hover:opacity-100"
                style={{
                  top: `${m.topPct}%`,
                  height: `max(3px, ${m.heightPct}%)`,
                  background: flagColor(m.region.flag),
                }}
              />
            </TooltipTrigger>
            <TooltipContent
              container={container}
              side="left"
              className="flex-col items-start gap-1"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: flagColor(m.region.flag) }}
                />
                <span className="font-mono font-semibold">{m.region.name}</span>
                <span
                  className="text-[9px] font-semibold tracking-[0.12em] uppercase"
                  style={{ color: flagColor(m.region.flag) }}
                >
                  {m.region.flag}
                </span>
              </span>
              {m.region.note.trim().length > 0 && (
                <span className="line-clamp-2 max-w-56 text-[11px] opacity-80">
                  {m.region.note}
                </span>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
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
    </TooltipProvider>
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
  const { outlineVisible, inspectorVisible } = useUiPrefs()
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
      {/* Pane toggles carry their pane's container-query class, so a toggle
          never shows where the pane couldn't render anyway. */}
      <button
        type="button"
        aria-pressed={outlineVisible}
        title={outlineVisible ? "Hide regions pane" : "Show regions pane"}
        aria-label={outlineVisible ? "Hide regions pane" : "Show regions pane"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setUiPrefs({ outlineVisible: !outlineVisible })}
        className={cn(
          "hidden hover:text-foreground @5xl:inline-flex",
          !outlineVisible && "opacity-50"
        )}
      >
        <PanelLeft className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-pressed={inspectorVisible}
        title={inspectorVisible ? "Hide inspector pane" : "Show inspector pane"}
        aria-label={inspectorVisible ? "Hide inspector pane" : "Show inspector pane"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setUiPrefs({ inspectorVisible: !inspectorVisible })}
        className={cn(
          "hidden hover:text-foreground @3xl:inline-flex",
          !inspectorVisible && "opacity-50"
        )}
      >
        <PanelRight className="size-3.5" aria-hidden />
      </button>
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
