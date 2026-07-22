// Automatic snippet matching: find spans of a prompt body that exactly equal a
// snippet's canonical body, so pasted (or retyped) snippet content gets
// auto-marked as a linked region without any user action. Plain-text indexOf
// only — never an LLM. The matcher is pure and hand-testable; the dismissal
// store (localStorage, pw:v1: namespace like fold.ts) remembers per-doc "stop
// marking this snippet here" choices so removing a region isn't gaslighting.

import type { Region } from "@/lib/editor"
import { regionsOverlap } from "@/lib/editor"
import { readJSON, removeKey, writeJSON } from "@/lib/local"

/** Trivial snippets (< 24 trimmed chars ≈ 6 tokens) match incidentally — a
 *  bare `## Role` heading would spam regions. A real reusable block is
 *  comfortably longer. */
export const MIN_MATCH_CHARS = 24

export interface MatchCandidate {
  snippetId: string
  name: string
  version: number
  /** Canonical body (getSnippetBody) — matched raw, so a hit is born synced. */
  body: string
}

/** A span to mark: shaped for addRegionEffect, born in-sync by construction
 *  (the matched text === the canonical body at `syncedVersion`). */
export interface SnippetMatch {
  name: string
  from: number
  to: number
  snippetId: string
  syncedVersion: number
}

/** All non-overlapping exact occurrences of candidate bodies in `body`.
 *  Longest-candidate-first, so a snippet whose body contains another
 *  snippet's body wins the span. Occurrences overlapping existing regions or
 *  earlier-accepted matches are skipped — the same ambiguity rule as
 *  markSelection. Pure: no store reads, no I/O. */
export function findSnippetMatches(
  body: string,
  regions: readonly Region[],
  candidates: readonly MatchCandidate[]
): SnippetMatch[] {
  const accepted: SnippetMatch[] = []
  // Interval list for the overlap guard; grows as matches are accepted. The
  // throwaway Region shape just reuses the predicate the rest of the app trusts.
  const taken: Region[] = [...regions]
  const sorted = [...candidates]
    .filter((c) => c.body.trim().length >= MIN_MATCH_CHARS)
    .sort((a, b) => b.body.length - a.body.length)
  for (const c of sorted) {
    let idx = body.indexOf(c.body)
    while (idx !== -1) {
      const to = idx + c.body.length
      if (!regionsOverlap(taken, idx, to)) {
        accepted.push({
          name: c.name,
          from: idx,
          to,
          snippetId: c.snippetId,
          syncedVersion: c.version,
        })
        taken.push({ id: "", name: "", flag: "ok", note: "", from: idx, to })
        idx = body.indexOf(c.body, to)
      } else {
        idx = body.indexOf(c.body, idx + 1)
      }
    }
  }
  return accepted
}

// ---- Dismissals -----------------------------------------------------------
// pw:v1:nomatch:<docId> → { [snippetId]: snippet.version at dismissal }.
// Written when the user removes a LINKED region in a prompt (hand-marked ones
// included — their text equals the canonical by construction, so without a
// dismissal the scanner would re-mark within a second). The scan skips a
// snippet while its version hasn't advanced past the stored one.

const dismissKey = (docId: string) => `pw:v1:nomatch:${docId}`

export function dismissSnippetMatch(
  docId: string,
  snippetId: string,
  version: number
): void {
  const cur = readJSON<Record<string, number>>(dismissKey(docId)) ?? {}
  cur[snippetId] = version
  writeJSON(dismissKey(docId), cur)
}

/** Read + prune + rewrite the doc's dismissals; returns the snippet ids the
 *  scan must skip. Pruned (dismissal forgotten) when: the snippet is gone;
 *  its version advanced past the stored one (a version bump always
 *  accompanies a canonical-body change, so newly-matching text is a fresh
 *  paste of NEW content — fresh intent); or the canonical body no longer
 *  occurs in the doc at all (the text was fully deleted, so a later paste is
 *  fresh intent too, not the dismissed occurrence). Same staleness-guard
 *  spirit as fold.ts's stored-length check. */
export function effectiveDismissals(
  docId: string,
  body: string,
  candidates: readonly MatchCandidate[]
): Set<string> {
  const stored = readJSON<Record<string, number>>(dismissKey(docId))
  if (!stored) return new Set()
  const byId = new Map(candidates.map((c) => [c.snippetId, c]))
  const kept: Record<string, number> = {}
  const skip = new Set<string>()
  for (const [snippetId, version] of Object.entries(stored)) {
    const c = byId.get(snippetId)
    if (!c || typeof version !== "number") continue
    if (c.version > version) continue
    if (!body.includes(c.body)) continue
    kept[snippetId] = version
    skip.add(snippetId)
  }
  if (Object.keys(kept).length === 0) removeKey(dismissKey(docId))
  else writeJSON(dismissKey(docId), kept)
  return skip
}
