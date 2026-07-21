import { useCallback, useEffect, useRef, useState } from "react"

import { LibrarySidebar } from "@/components/shell/library-sidebar"
import { Workspace, type WorkspaceHandle } from "@/components/shell/workspace"
import { hydrate, useLibrary } from "@/lib/library"

function App() {
  const workspaceRef = useRef<WorkspaceHandle>(null)
  const { status, error } = useLibrary()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [openDocIds, setOpenDocIds] = useState<string[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)

  // Load the library once at startup; the shell waits for it (hydrate() is
  // idempotent, so StrictMode's double-invoke is harmless).
  useEffect(() => {
    void hydrate()
  }, [])

  const handleOpenDocsChange = useCallback(
    (ids: string[]) => setOpenDocIds(ids),
    []
  )
  const handleActiveDocChange = useCallback(
    (id: string | null) => setActiveDocId(id),
    []
  )

  if (status !== "ready") {
    return (
      <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">
        Loading library…
      </div>
    )
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      {error && (
        <div className="shrink-0 border-b bg-amber-100 px-3 py-1 text-center text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <LibrarySidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
          activeDocId={activeDocId}
          openDocIds={openDocIds}
          onOpenDoc={(id) => workspaceRef.current?.openDoc(id)}
          onOpenDocToSide={(id) => workspaceRef.current?.openDocToSide(id)}
        />
        <main className="min-w-0 flex-1">
          <Workspace
            ref={workspaceRef}
            onOpenDocsChange={handleOpenDocsChange}
            onActiveDocChange={handleActiveDocChange}
          />
        </main>
      </div>
    </div>
  )
}

export default App
