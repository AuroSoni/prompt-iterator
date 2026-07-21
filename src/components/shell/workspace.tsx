import { useCallback, useEffect, useImperativeHandle, useRef } from "react"
import type { Ref } from "react"
import { DockviewReact, themeLightSpaced } from "dockview-react"
import type {
  DockviewApi,
  DockviewReadyEvent,
  IDockviewPanel,
} from "dockview-react"
import "dockview-react/dist/styles/dockview.css"

import {
  DocTab,
  EditorSlotPanel,
  WorkspaceWatermark,
  type SlotParams,
} from "@/components/shell/editor-slot"
import { getDoc, PROMPTS } from "@/lib/library"

/** The shell holds at most four generic editor slots (Phase 0 decision). */
export const MAX_SLOTS = 4

export interface WorkspaceHandle {
  /** Open a doc in the active slot — a library click fills what you're looking at. */
  openDoc: (docId: string) => void
  /** Open a doc in a new slot split right of the active one (⊞). */
  openDocToSide: (docId: string) => void
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

  useImperativeHandle(ref, () => ({ openDoc, openDocToSide }), [
    openDoc,
    openDocToSide,
  ])

  const disposablesRef = useRef<Array<{ dispose(): void }>>([])

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api
      disposablesRef.current = [
        event.api.onDidAddPanel(sync),
        event.api.onDidRemovePanel(sync),
        event.api.onDidActivePanelChange(sync),
      ]
      // Fresh workspace: open the first prompt so the shell never starts empty.
      const first = PROMPTS[0]
      if (first && event.api.panels.length === 0) {
        addSlot(event.api, "slot-1", first.id)
      }
      sync()
    },
    [sync]
  )

  useEffect(
    () => () => {
      disposablesRef.current.forEach((d) => d.dispose())
      disposablesRef.current = []
    },
    []
  )

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
