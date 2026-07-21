import { useCallback, useEffect, useRef, useState } from "react"

import { LibrarySidebar } from "@/components/shell/library-sidebar"
import { Workspace, type WorkspaceHandle } from "@/components/shell/workspace"
import { LoginScreen } from "@/components/auth/login-screen"
import { initAuth, signOut, useAuth } from "@/lib/auth"
import {
  createPrompt,
  createSnippet,
  deleteDoc,
  renameDoc,
  reportError,
  useLibrary,
} from "@/lib/library"
import { isSupabaseConfigured } from "@/lib/supabase"

function App() {
  const workspaceRef = useRef<WorkspaceHandle>(null)
  const { status: authStatus } = useAuth()
  const { status, error } = useLibrary()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [openDocIds, setOpenDocIds] = useState<string[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)

  // Wire auth once at startup. The auth store owns library hydration — it loads
  // on sign-in (or immediately when Supabase is unconfigured), so a signed-out
  // client never hits the authenticated-only DB. Idempotent under StrictMode.
  useEffect(() => {
    initAuth()
  }, [])

  const handleOpenDocsChange = useCallback(
    (ids: string[]) => setOpenDocIds(ids),
    []
  )
  const handleActiveDocChange = useCallback(
    (id: string | null) => setActiveDocId(id),
    []
  )

  // Structural CRUD: create/rename/delete write through the store (await-first),
  // then open or close the relevant panes. Failures surface on the shared banner.
  const handleCreatePrompt = useCallback(async (): Promise<string | null> => {
    try {
      const id = await createPrompt("untitled-prompt")
      workspaceRef.current?.openDoc(id)
      return id
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Couldn't create the prompt.")
      return null
    }
  }, [])

  const handleCreateSnippet = useCallback(async (): Promise<string | null> => {
    try {
      const id = await createSnippet("untitled-snippet")
      workspaceRef.current?.openDoc(id)
      return id
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Couldn't create the snippet.")
      return null
    }
  }, [])

  const handleRenameDoc = useCallback(async (id: string, name: string) => {
    try {
      await renameDoc(id, name)
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Couldn't rename.")
    }
  }, [])

  const handleDeleteDoc = useCallback(async (id: string) => {
    try {
      const removed = await deleteDoc(id)
      workspaceRef.current?.closeDocs(removed)
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Couldn't delete.")
    }
  }, [])

  const handleSignOut = useCallback(() => {
    void signOut()
  }, [])

  if (authStatus === "loading") {
    return (
      <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (authStatus === "signed-out") {
    return <LoginScreen />
  }

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
          onCreatePrompt={handleCreatePrompt}
          onCreateSnippet={handleCreateSnippet}
          onRenameDoc={handleRenameDoc}
          onDeleteDoc={handleDeleteDoc}
          onSignOut={isSupabaseConfigured ? handleSignOut : undefined}
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
