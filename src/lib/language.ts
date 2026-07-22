// Grammar-based highlighting for the mixed content of real prompts: markdown
// (GFM) with inline XML-ish tags via the nested HTML parser, JSON inside
// ```json fences, and a regex overlay for jinja markers — the one notation no
// grammar knows. Colors live entirely in index.css (`tok-*` / `pi-jinja`
// classes over CSS variables), so dark mode and zen/x-ray restyle without JS.

import { jsonLanguage } from "@codemirror/lang-json"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { syntaxHighlighting } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import { Decoration, EditorView, MatchDecorator, ViewPlugin } from "@codemirror/view"
import type { DecorationSet, ViewUpdate } from "@codemirror/view"
import { classHighlighter, tagHighlighter, tags } from "@lezer/highlight"

// Jinja markers: {{ expr }}, {% stmt %}, {# comment #} — tolerant interiors
// ({{ x.y | filter }} matches), single-line by design. Deliberately decorates
// even inside strings/fences: a template marker is a template marker.
const jinjaDeco = new MatchDecorator({
  regexp: /\{\{[^\n]*?\}\}|\{%[^\n]*?%\}|\{#[^\n]*?#\}/g,
  decoration: () => Decoration.mark({ class: "pi-jinja" }),
})

const jinjaHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = jinjaDeco.createDeco(view)
    }
    update(u: ViewUpdate) {
      this.decorations = jinjaDeco.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations }
)

/** Language support + highlighting for prompt docs. Always-on (NOT in the
 *  mode compartment) — zen keeps highlighting, only gutters change. */
export function promptLanguage(): Extension {
  return [
    markdown({
      base: markdownLanguage, // GFM: tables, strikethrough, task lists
      codeLanguages: (info) =>
        /^json5?$/i.test(info) ? jsonLanguage : null,
      // Keep the default typing behavior: the markdown keymap (Enter continues
      // lists, Backspace deletes markup) is a product decision, not a
      // highlighting side-effect.
      addKeymap: false,
    }),
    syntaxHighlighting(classHighlighter),
    // classHighlighter has no entry for tags.monospace — which is exactly what
    // lang-markdown puts on inline code and fence text. Supplement it.
    syntaxHighlighting(
      tagHighlighter([{ tag: tags.monospace, class: "tok-monospace" }])
    ),
    jinjaHighlight,
  ]
}
