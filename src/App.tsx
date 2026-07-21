import { useCallback, useRef, useState } from "react"

import { LibrarySidebar } from "@/components/shell/library-sidebar"
import { Workspace, type WorkspaceHandle } from "@/components/shell/workspace"

function App() {
  const workspaceRef = useRef<WorkspaceHandle>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [openDocIds, setOpenDocIds] = useState<string[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)

  const handleOpenDocsChange = useCallback(
    (ids: string[]) => setOpenDocIds(ids),
    []
  )
  const handleActiveDocChange = useCallback(
    (id: string | null) => setActiveDocId(id),
    []
  )

  return (
    <div className="flex h-svh overflow-hidden">
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
  )
}

export default App
