import { useCallback, useEffect, useImperativeHandle, useRef } from "react"
import type { Ref } from "react"
import { DockviewReact, themeLightSpaced } from "dockview-react"
import type {
  DockviewApi,
  DockviewReadyEvent,
  IDockviewPanel,
  SerializedDockview,
} from "dockview-react"
import "dockview-react/dist/styles/dockview.css"

import {
  DocTab,
  EditorSlotPanel,
  WorkspaceWatermark,
  type SlotParams,
} from "@/components/shell/editor-slot"
import { firstPromptId, getDoc } from "@/lib/library"
import { readJSON, removeKey, writeJSON } from "@/lib/local"

/** The shell holds at most four generic editor slots (Phase 0 decision). */
export const MAX_SLOTS = 4

/** Serialized dockview grid (open docs, splits, sizes, active group). View
 *  state like ui-prefs: localStorage only, never the DB. */
const LAYOUT_KEY = "pw:v1:layout"

/** onDidLayoutChange fires per micro-step of a resize drag; batch to one write. */
const LAYOUT_SAVE_DELAY_MS = 500

export interface WorkspaceHandle {
  /** Open a doc in the active slot — a library click fills what you're looking at. */
  openDoc: (docId: string) => void
  /** Open a doc in a new slot split right of the active one (⊞). */
  openDocToSide: (docId: string) => void
  /** Close any slots showing these docs — e.g. after a doc (and its versions)
   *  are deleted, so no pane lingers on a now-missing document. */
  closeDocs: (docIds: string[]) => void
}

interface WorkspaceProps {
  ref?: Ref<WorkspaceHandle>
  onOpenDocsChange?: (docIds: string[]) => void
  onActiveDocChange?: (docId: string | null) => void
}

const components = { "editor-slot": EditorSlotPanel }
const tabComponents = { "doc-tab": DocTab }

function docIdOf(panel: IDockviewPanel | undefined): string | null {
  return (panel?.params as SlotParams | undefined)?.docId ?? null
}

function panelForDoc(api: DockviewApi, docId: string): IDockviewPanel | undefined {
  return api.panels.find((p) => docIdOf(p) === docId)
}

/** Slots have stable ids; the doc they carry is a parameter. */
function nextSlotId(api: DockviewApi): string | null {
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const id = `slot-${i}`
    if (!api.getPanel(id)) return id
  }
  return null
}

function addSlot(
  api: DockviewApi,
  slotId: string,
  docId: string,
  position?: { referencePanel: string; direction: "right" }
) {
  api.addPanel<SlotParams>({
    id: slotId,
    component: "editor-slot",
    tabComponent: "doc-tab",
    params: { docId },
    position,
  })
}

export function Workspace({
  ref,
  onOpenDocsChange,
  onActiveDocChange,
}: WorkspaceProps) {
  const apiRef = useRef<DockviewApi | null>(null)
  // Latest callbacks in a ref so dockview event subscriptions never go stale.
  const callbacksRef = useRef({ onOpenDocsChange, onActiveDocChange })
  callbacksRef.current = { onOpenDocsChange, onActiveDocChange }

  const sync = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    callbacksRef.current.onOpenDocsChange?.(
      api.panels
        .map((p) => docIdOf(p))
        .filter((id): id is string => id !== null)
    )
    callbacksRef.current.onActiveDocChange?.(docIdOf(api.activePanel))
  }, [])

  const openDoc = useCallback(
    (docId: string) => {
      const api = apiRef.current
      if (!api || !getDoc(docId)) return
      const existing = panelForDoc(api, docId)
      if (existing) {
        existing.api.setActive()
        sync()
        return
      }
      const active = api.activePanel
      if (active) {
        // Fill the active slot rather than spawning a new pane per click.
        active.update({ params: { docId } })
        active.api.setActive()
      } else {
        const slotId = nextSlotId(api)
        if (slotId) addSlot(api, slotId, docId)
      }
      sync()
    },
    [sync]
  )

  const openDocToSide = useCallback(
    (docId: string) => {
      const api = apiRef.current
      if (!api || !getDoc(docId)) return
      const existing = panelForDoc(api, docId)
      if (existing) {
        existing.api.setActive()
        sync()
        return
      }
      const slotId = nextSlotId(api)
      if (!slotId) {
        // All four slots in use — fall back to filling the active slot.
        openDoc(docId)
        return
      }
      const active = api.activePanel
      addSlot(
        api,
        slotId,
        docId,
        active ? { referencePanel: active.id, direction: "right" } : undefined
      )
      sync()
    },
    [openDoc, sync]
  )

  const closeDocs = useCallback(
    (docIds: string[]) => {
      const api = apiRef.current
      if (!api || docIds.length === 0) return
      const targets = new Set(docIds)
      // Copy the list: panel.api.close() mutates api.panels as we iterate.
      for (const panel of [...api.panels]) {
        const id = docIdOf(panel)
        if (id !== null && targets.has(id)) panel.api.close()
      }
      // onDidRemovePanel fires sync() per close; call once more in case nothing
      // matched so open/active state is always reconciled.
      sync()
    },
    [sync]
  )

  useImperativeHandle(ref, () => ({ openDoc, openDocToSide, closeDocs }), [
    openDoc,
    openDocToSide,
    closeDocs,
  ])

  const disposablesRef = useRef<Array<{ dispose(): void }>>([])
  const saveTimerRef = useRef(0)

  const saveLayoutNow = useCallback(() => {
    window.clearTimeout(saveTimerRef.current)
    const api = apiRef.current
    if (!api) return
    try {
      writeJSON(LAYOUT_KEY, api.toJSON())
    } catch {
      // Dockview mid-disposal — the last debounced save already captured state.
    }
  }, [])

  const scheduleLayoutSave = useCallback(() => {
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(saveLayoutNow, LAYOUT_SAVE_DELAY_MS)
  }, [saveLayoutNow])

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api
      disposablesRef.current = [
        event.api.onDidAddPanel(sync),
        event.api.onDidRemovePanel(sync),
        event.api.onDidActivePanelChange(sync),
        event.api.onDidLayoutChange(scheduleLayoutSave),
      ]
      // Restore the previous session's grid. Panels carry their docId in
      // params, so the layout round-trips whole; docs deleted since the save
      // are pruned (the shell only mounts post-hydration, so getDoc is
      // authoritative). A malformed payload starts fresh.
      const saved = readJSON<SerializedDockview>(LAYOUT_KEY)
      if (saved) {
        try {
          event.api.fromJSON(saved)
          for (const panel of [...event.api.panels]) {
            const id = docIdOf(panel)
            if (!id || !getDoc(id)) panel.api.close()
          }
        } catch {
          event.api.clear()
          removeKey(LAYOUT_KEY)
        }
      }
      // Fresh workspace (nothing stored, or nothing survived pruning): open
      // the first prompt so the shell never starts empty.
      const first = firstPromptId()
      if (first && event.api.panels.length === 0) {
        addSlot(event.api, "slot-1", first)
      }
      sync()
    },
    [scheduleLayoutSave, sync]
  )

  useEffect(() => {
    // A reload inside the debounce window must not lose the last change.
    window.addEventListener("beforeunload", saveLayoutNow)
    return () => {
      window.removeEventListener("beforeunload", saveLayoutNow)
      saveLayoutNow()
      disposablesRef.current.forEach((d) => d.dispose())
      disposablesRef.current = []
    }
  }, [saveLayoutNow])

  return (
    <DockviewReact
      className="workspace-dockview"
      theme={themeLightSpaced}
      components={components}
      tabComponents={tabComponents}
      watermarkComponent={WorkspaceWatermark}
      onReady={handleReady}
    />
  )
}
