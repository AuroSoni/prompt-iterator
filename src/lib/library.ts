// In-memory sample library so the shell has real shapes to arrange.
// Phase 1 proper replaces this with Supabase-backed data; the types mirror the
// intended schema (prompts → versions, snippets with usage links).

export type DocKind = "prompt" | "snippet" | "version"

export interface PromptVersion {
  id: string
  promptId: string
  n: number
  message: string
  savedAt: string
  tokens: number
}

export interface Prompt {
  id: string
  name: string
  tokens: number
  /** Version number the working copy was last saved as. */
  currentVersion: number
  versions: PromptVersion[]
}

export interface Snippet {
  id: string
  name: string
  tokens: number
  version: number
  /** How many prompts have inserted this snippet (copy-on-insert links). */
  usedBy: number
  /** How many of those prompts hold an older snippet version than current. */
  stale: number
}

/** A resolved, openable document — what an editor slot displays. */
export interface Doc {
  id: string
  kind: DocKind
  title: string
  tokens: number
  readOnly: boolean
  body: string
}

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
}

function versionsOf(
  promptId: string,
  entries: Array<[n: number, message: string, savedAt: string, tokens: number]>
): PromptVersion[] {
  return entries.map(([n, message, savedAt, tokens]) => ({
    id: `${promptId}v${n}`,
    promptId,
    n,
    message,
    savedAt,
    tokens,
  }))
}

export const PROMPTS: Prompt[] = [
  {
    id: "p1",
    name: "support-triage-agent",
    tokens: 3900,
    currentVersion: 5,
    versions: versionsOf("p1", [
      [5, "tighten refusal criteria", "2026-07-18", 3900],
      [4, "add billing escalation path", "2026-07-11", 3720],
      [3, "rewrite tone section", "2026-07-02", 3540],
      [2, "add few-shot examples", "2026-06-24", 3300],
      [1, "initial draft", "2026-06-20", 2100],
    ]),
  },
  {
    id: "p2",
    name: "code-review-assistant",
    tokens: 4400,
    currentVersion: 3,
    versions: versionsOf("p2", [
      [3, "severity rubric overhaul", "2026-07-15", 4400],
      [2, "split style vs correctness", "2026-07-05", 4100],
      [1, "initial draft", "2026-06-28", 3600],
    ]),
  },
  {
    id: "p3",
    name: "sql-query-generator",
    tokens: 2800,
    currentVersion: 4,
    versions: versionsOf("p3", [
      [4, "schema-awareness rules", "2026-07-19", 2800],
      [3, "forbid destructive statements", "2026-07-09", 2650],
      [2, "dialect notes (Postgres)", "2026-07-01", 2400],
      [1, "initial draft", "2026-06-22", 1900],
    ]),
  },
  {
    id: "p4",
    name: "onboarding-walkthrough",
    tokens: 3200,
    currentVersion: 2,
    versions: versionsOf("p4", [
      [2, "shorten step descriptions", "2026-07-16", 3200],
      [1, "initial draft", "2026-07-10", 3050],
    ]),
  },
]

export const SNIPPETS: Snippet[] = [
  { id: "s1", name: "output-format", tokens: 380, version: 4, usedBy: 3, stale: 2 },
  { id: "s2", name: "tone-of-voice", tokens: 240, version: 2, usedBy: 4, stale: 0 },
  { id: "s3", name: "safety-refusals", tokens: 520, version: 3, usedBy: 2, stale: 0 },
  { id: "s4", name: "few-shot-header", tokens: 610, version: 1, usedBy: 1, stale: 1 },
]

const PROMPT_SECTIONS = [
  "Role",
  "Context",
  "Constraints",
  "Output format",
  "Examples",
  "Refusals",
]

function fakeParagraph(topic: string, title: string): string {
  return (
    `Placeholder body for the “${topic}” section of ${title}. In the real ` +
    `Phase 1 editor this is continuous prose with named regions painted over ` +
    `spans of it — text can exist outside any region, and regions can be ` +
    `ragged. This filler exists only so the shell has something to lay out.`
  )
}

function fakePromptBody(title: string, tokens: number): string {
  // Longer prompts get more sections so panes have visibly different lengths.
  const count = Math.max(3, Math.min(PROMPT_SECTIONS.length, Math.round(tokens / 800)))
  return PROMPT_SECTIONS.slice(0, count)
    .map((s) => `## ${s}\n\n${fakeParagraph(s, title)}`)
    .join("\n\n")
}

function fakeSnippetBody(name: string): string {
  return `## ${name}\n\n${fakeParagraph(name, "the snippet library")}\n\nInserting this snippet copies its text into the prompt and records the source version — editing it here never silently mutates prompts that use it.`
}

const DOCS = new Map<string, Doc>()

for (const p of PROMPTS) {
  DOCS.set(p.id, {
    id: p.id,
    kind: "prompt",
    title: p.name,
    tokens: p.tokens,
    readOnly: false,
    body: fakePromptBody(p.name, p.tokens),
  })
  for (const v of p.versions) {
    DOCS.set(v.id, {
      id: v.id,
      kind: "version",
      title: `${p.name} · v${v.n}`,
      tokens: v.tokens,
      readOnly: true,
      body: `> Snapshot v${v.n} — “${v.message}” (${v.savedAt})\n\n${fakePromptBody(p.name, v.tokens)}`,
    })
  }
}

for (const s of SNIPPETS) {
  DOCS.set(s.id, {
    id: s.id,
    kind: "snippet",
    title: s.name,
    tokens: s.tokens,
    readOnly: false,
    body: fakeSnippetBody(s.name),
  })
}

export function getDoc(id: string): Doc | undefined {
  return DOCS.get(id)
}
