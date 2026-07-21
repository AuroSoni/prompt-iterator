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
    sort_order: number
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
    sort_order?: number
    updated_at?: string
  }
  Update: Partial<SnippetsTable["Insert"]>
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      prompts: PromptsTable
      prompt_versions: PromptVersionsTable
      snippets: SnippetsTable
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
