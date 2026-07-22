import { useCallback, useEffect, useRef, useState } from "react"

import { LibrarySidebar } from "@/components/shell/library-sidebar"
import { Workspace, type WorkspaceHandle } from "@/components/shell/workspace"
import { LoginScreen } from "@/components/auth/login-screen"
import { initAuth, signOut, useAuth } from "@/lib/auth"
import {
  addRegionEffect,
  getView,
  regionsField,
  regionsOverlap,
} from "@/lib/editor"
import {
  createFolder,
  createPrompt,
  createSnippet,
  deleteDoc,
  deleteFolder,
  flushPendingNow,
  getDoc,
  getSnippet,
  getSnippetBody,
  moveDoc,
  moveFolder,
  promoteSnippet,
  renameDoc,
  renameFolder,
  reportError,
  useLibrary,
  type FolderSection,
} from "@/lib/library"
import { isSupabaseConfigured } from "@/lib/supabase"
import { setUiPrefs, useUiPrefs } from "@/lib/ui-prefs"

function App() {
  const workspaceRef = useRef<WorkspaceHandle>(null)
  const { status: authStatus } = useAuth()
  const { status, error } = useLibrary()
  const { sidebarCollapsed } = useUiPrefs()
  const [openDocIds, setOpenDocIds] = useState<string[]>([])
  const [activeDocId, setActiveDocId] = useState<string | null>(null)

  // Wire auth once at startup. The auth store owns library hydration — it loads
  // on sign-in (or immediately when Supabase is unconfigured), so a signed-out
  // client never hits the authenticated-only DB. Idempotent under StrictMode.
  useEffect(() => {
    initAuth()
  }, [])

  // Ctrl/Cmd+S anywhere outside the editor (sidebar, inspector) force-saves
  // too. The editor's own Mod-s keymap handles it first and preventDefaults,
  // which the guard respects — no double flush, no browser Save dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        if (e.defaultPrevented) return
        e.preventDefault()
        void flushPendingNow()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
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

  // Insert a snippet's canonical text at the active prompt's cursor, as a linked
  // region. Uses the editor-view registry to reach the doc the user is looking
  // at (the sidebar only knows ids). Guards: needs an editable prompt focused,
  // and won't drop a linked region inside an existing one (overlap).
  const handleInsertSnippet = useCallback(
    (snippetId: string) => {
      if (!activeDocId) {
        reportError("Open a prompt and place your cursor to insert a snippet.")
        return
      }
      const target = getDoc(activeDocId)
      if (!target || target.kind !== "prompt" || target.readOnly) {
        reportError("Insert into a prompt — open one and click where it goes.")
        return
      }
      const view = getView(activeDocId)
      const snip = getSnippet(snippetId)
      const body = getSnippetBody(snippetId)
      if (!view || !snip || !body) return
      const pos = view.state.selection.main.head
      if (regionsOverlap(view.state.field(regionsField), pos, pos)) {
        reportError("Move the cursor outside an existing region to insert.")
        return
      }
      view.dispatch({
        changes: { from: pos, insert: body },
        effects: addRegionEffect.of({
          id: `r${Date.now().toString(36)}`,
          name: snip.name,
          flag: "ok",
          note: "",
          from: pos,
          to: pos + body.length,
          snippetId,
          syncedVersion: snip.version,
        }),
        selection: { anchor: pos + body.length },
      })
      view.focus()
    },
    [activeDocId]
  )

  const handlePromoteSnippet = useCallback(async (snippetId: string) => {
    try {
      await promoteSnippet(snippetId)
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Couldn't promote the snippet.")
    }
  }, [])

  // Folder CRUD: same await-first + banner idiom as the doc handlers. Folder
  // deletes move contents up a level, so no editor panes need closing.
  const handleCreateFolder = useCallback(
    async (
      section: FolderSection,
      parentId: string | null
    ): Promise<string | null> => {
      try {
        return await createFolder(section, parentId)
      } catch (e) {
        reportError(e instanceof Error ? e.message : "Couldn't create the folder.")
        return null
      }
    },
    []
  )

  const handleRenameFolder = useCallback(async (id: string, name: string) => {
    try {
      await renameFolder(id, name)
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Couldn't rename the folder.")
    }
  }, [])

  const handleDeleteFolder = useCallback(async (id: string) => {
    try {
      await deleteFolder(id)
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Couldn't delete the folder.")
    }
  }, [])

  const handleMoveFolder = useCallback(
    async (id: string, parentId: string | null, index: number) => {
      try {
        await moveFolder(id, parentId, index)
      } catch (e) {
        reportError(e instanceof Error ? e.message : "Couldn't move the folder.")
      }
    },
    []
  )

  const handleMoveDoc = useCallback(
    async (docId: string, folderId: string | null, index: number) => {
      try {
        await moveDoc(docId, folderId, index)
      } catch (e) {
        reportError(e instanceof Error ? e.message : "Couldn't move.")
      }
    },
    []
  )

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
          onToggleCollapsed={() =>
            setUiPrefs({ sidebarCollapsed: !sidebarCollapsed })
          }
          activeDocId={activeDocId}
          openDocIds={openDocIds}
          onOpenDoc={(id) => workspaceRef.current?.openDoc(id)}
          onOpenDocToSide={(id) => workspaceRef.current?.openDocToSide(id)}
          onCreatePrompt={handleCreatePrompt}
          onCreateSnippet={handleCreateSnippet}
          onRenameDoc={handleRenameDoc}
          onDeleteDoc={handleDeleteDoc}
          onInsertSnippet={handleInsertSnippet}
          onPromoteSnippet={handlePromoteSnippet}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onMoveFolder={handleMoveFolder}
          onMoveDoc={handleMoveDoc}
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
