// Hand-written to match supabase/migrations/0001_init.sql. Once the project is
// live, regenerate with: `supabase gen types typescript --project-id <ref>`.
//
// The JSONB `regions` column stores the editor's Region[] verbatim, so we reuse
// that type rather than redeclaring its shape.

import type { Region } from "@/lib/editor"

interface PromptsTable {
  Row: {
    id: string
    name: string
    body: string
    regions: Region[]
    tokens: number
    current_version: number
    sort_order: number
    /** Containing folder; null = section root. See 0005_folders.sql. */
    folder_id: string | null
    updated_at: string
  }
  Insert: {
    id: string
    name: string
    body?: string
    regions?: Region[]
    tokens?: number
    current_version?: number
    sort_order?: number
    folder_id?: string | null
    updated_at?: string
  }
  Update: Partial<PromptsTable["Insert"]>
  Relationships: []
}

interface PromptVersionsTable {
  Row: {
    id: string
    prompt_id: string
    n: number
    message: string
    body: string
    regions: Region[]
    tokens: number
    saved_at: string
  }
  Insert: {
    id: string
    prompt_id: string
    n: number
    message?: string
    body?: string
    regions?: Region[]
    tokens?: number
    saved_at?: string
  }
  Update: Partial<PromptVersionsTable["Insert"]>
  Relationships: []
}

interface SnippetsTable {
  Row: {
    id: string
    name: string
    body: string
    regions: Region[]
    tokens: number
    version: number
    used_by: number
    stale: number
    /** True for snippets shown in the library list (authored/promoted). See
     *  supabase/migrations/0004_snippet_library.sql. */
    library: boolean
    sort_order: number
    /** Containing folder; null = section root. See 0005_folders.sql. */
    folder_id: string | null
    /** Snippet-level annotation (one-way rollup). See 0006_snippet_note.sql. */
    note: string
    updated_at: string
  }
  Insert: {
    id: string
    name: string
    body?: string
    regions?: Region[]
    tokens?: number
    version?: number
    used_by?: number
    stale?: number
    library?: boolean
    sort_order?: number
    folder_id?: string | null
    note?: string
    updated_at?: string
  }
  Update: Partial<SnippetsTable["Insert"]>
  Relationships: []
}

// Per-section folder trees for the library sidebar (0005_folders.sql). The
// client reparents children before deleting a folder; the FK `set null`
// actions are only an out-of-band safety net.
interface FoldersTable {
  Row: {
    id: string
    name: string
    section: "prompt" | "snippet"
    parent_id: string | null
    sort_order: number
    updated_at: string
  }
  Insert: {
    id: string
    name: string
    section: "prompt" | "snippet"
    parent_id?: string | null
    sort_order?: number
    updated_at?: string
  }
  Update: Partial<FoldersTable["Insert"]>
  Relationships: []
}

// Key/value app metadata (see supabase/migrations/0002_app_meta.sql). Holds the
// `seeded` marker so a delete-all doesn't trigger a reseed.
interface AppMetaTable {
  Row: {
    key: string
    value: Record<string, unknown>
  }
  Insert: {
    key: string
    value?: Record<string, unknown>
  }
  Update: Partial<AppMetaTable["Insert"]>
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      prompts: PromptsTable
      prompt_versions: PromptVersionsTable
      snippets: SnippetsTable
      folders: FoldersTable
      app_meta: AppMetaTable
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
