# Prompt Workbench

## Purpose

A web-based **authoring and comprehension environment for long prompts**.

The problem is not "which prompt performs better" — it is that a 3,000–5,000 token
prompt is hard to hold in your head. You lose the skeleton, sections quietly
contradict each other, and you can't remember why a given paragraph exists. Today
that prompt lives in a flat text file with no structure, no memory, and no way to
reuse a paragraph across prompts without copy-paste drift.

This tool makes a long prompt **legible**: you can see its shape, name and annotate
its parts, promote parts into reusable snippets, and move between versions.

### Explicitly out of scope

- Model execution — the tool never calls an LLM
- Evaluation, benchmarking, scoring, A/B testing
- Runtime prompt serving — no read API; the Nova Labs backend never fetches from here
- Multi-user collaboration, review workflows, permissions

The output is text on your clipboard or a downloaded file. Nothing depends on this
being up.

---

## Core model

**A prompt is a continuous document with named regions painted over spans of it.**

Not a stack of blocks. You write prose freely; regions are an annotation layer on
top, so text can exist outside any region and regions can be ragged.

- **Prompt** — a document, versioned as a whole
- **Region** — a named, marked span within a prompt
- **Snippet** — a region promoted into the shared library, versioned independently
- **Version** — an immutable snapshot of a whole prompt

### Snippet reuse: copy-on-insert

Inserting a snippet copies its text into the prompt and records which snippet
version it came from. Editing the snippet in the library does **not** silently
mutate prompts that use it. Instead the tool surfaces staleness:

> `output-format` has changed since 3 prompts inserted it — review

You then accept or ignore the update per prompt. No spooky action at a distance.

---

## Features

### Editor

- Continuous long-form text editor, comfortable for multi-thousand-token documents
- Select a span → mark it as a named region
- Regions carry a **note** (why this exists / what it's for)
- Regions carry a **flag**: `ok` / `suspect` / `stale` / `revisit`
- Promote a region to a library snippet
- Insert a snippet from the library at the cursor
- Flat regions only — no nesting in v1

### Comprehension aids

- **Collapsible outline sidebar** — region names as a jumpable tree; collapse what
  you aren't reading
- **Structure ribbon** — a vertical minimap showing each region's proportion of the
  document, so the shape of the prompt is visible at a glance
- **Token count per region**, plus a running total for the whole prompt
- Flagged regions visually distinct in both the editor and the outline

### Versioning

- Save a version of the whole prompt, with an optional message
- Browse version history; restore any version
- **Text diff between any two versions** of the same prompt
- Snippets are versioned separately, on the same model

### Snippet library

- Browse, search, edit, and version snippets
- For each snippet: which prompts currently use it, and which of them are stale

### Export

- Copy the resolved prompt to clipboard
- Download as a `.md` / `.txt` file
- Region markers are authoring metadata only — never present in exported text

---

## Non-functional

- **Surface:** web app only. No desktop app, no editor extension, no CLI.
- **Storage:** Supabase (Postgres) — prompts, versions, regions, snippets,
  snippet-usage links.
- **Users:** single user. Auth exists only to keep data private, not to coordinate
  between people.
- **Scale:** tens of prompts, thousands of tokens each. Correctness matters more
  than throughput; nothing here is on a latency path.

---

## Design & build phases

### Phase 0 — Design decisions (before any feature code)

- **Editor technology.** The riskiest choice in the project: the editor must support
  span-anchored decorations over continuous prose (regions survive edits around and
  inside them). Prototype region marking in a candidate (e.g. CodeMirror 6) before
  committing.
- **Data model.** Supabase schema for prompts, versions, regions, snippets, snippet
  versions, and snippet-usage links — including how region spans are anchored
  (offsets vs. markers) and how they are remapped as text changes.
- **Resolve the open questions below** — diff granularity, import path, and export
  markers all change the schema or editor work.

> **Decided (2026-07-21):** editor technology is **CodeMirror 6** — validated with
> four live prototypes (regions as `Decoration.mark` ranges over a shared
> `StateField`; outline, structure ribbon, and token counts as plain views over
> that state). UI direction: **"Cockpit"** as the default — dense three-pane
> instrument panel (outline tree · editor with region boundary tags · region
> inspector with editable flags/notes) — plus a switchable **"Zen X-ray" focus
> mode**: chrome-free full-bleed writing view with an X-ray toggle that dims prose
> and lights up region structure. Both modes share the same region data model.

> **Decided (2026-07-21):** application shell is a **collapsible library-tree
> sidebar + a tiling pane grid** — validated with five live wireframes. The
> sidebar is one tree: prompts with their versions nested underneath (current
> version badged) and a snippets section with usage counts; it collapses to
> reclaim width. The workspace holds up to four **generic editor slots** — each
> can carry a prompt, a snippet, or a read-only version — that the user arranges
> in any 2-D grid by dragging a pane onto another (edge zones split that side,
> center swaps) and resizes by dragging the gutters. The Cockpit / Zen editor
> above is the content _inside_ a slot. Implementation library: **dockview**
> (react-mosaic as a lighter fallback) for the dock-and-resize pane layout.

### Phase 1 — Core editing

Continuous editor; select-to-mark regions with name, note, and flag; prompt CRUD
persisted to Supabase behind single-user auth. Exit criterion: a real 4,000-token
prompt can be authored and regioned without fighting the editor.

### Phase 2 — Comprehension aids

Outline sidebar, structure ribbon, per-region and total token counts, flag
styling in editor and outline. Pure views over Phase 1 data.

### Phase 3 — Versioning

Save-with-message, history browsing, restore, and text diff between versions.
Establishes the immutable-snapshot model that snippets reuse.

### Phase 4 — Snippet library

Promote region → snippet, insert with copy-on-insert recording the source
version, library browse/search/edit, and the staleness surface ("changed since
inserted — review"). Depends on Phases 1 and 3.

### Phase 5 — Export & hardening

Clipboard copy and `.md`/`.txt` download of resolved text (region markers
stripped), plus polish passes on the editor at realistic document sizes.

---

## Open questions

1. **Does anyone else ever read or edit these prompts?** Not answered. If the
   co-founder needs even read access, the auth model and sharing story change.
2. **Backlinks were declined as a comprehension aid, but the staleness nudge
   requires the same usage index.** The data is there either way — worth deciding
   whether to surface it as a view, since it's nearly free.
3. **Regions on exported text.** Confirm that no downstream consumer wants the
   region names preserved as XML tags or comments.
4. **Diff granularity.** Plain text diff, or diff aligned to region boundaries?
   The latter is more useful and materially more work.
5. **Import path.** How do today's prompts get in — paste, file upload, or neither
   because there aren't many?