// Read-only hover card over region spans: see what a marked region is — flag,
// name, note, snippet sync — without opening anything. Editing lives in the
// selection popover (Mod-m) and the Inspector; hover never captures input.
// Plain DOM (CM tooltips render inside the editor, so the .prompt-editor
// scoped --flag-* vars resolve); styling in index.css under .pi-hover.

import type { Extension } from "@codemirror/state"
import { hoverTooltip } from "@codemirror/view"

import { approxTokens, flagColor, regionAt } from "@/lib/editor"
import { getSnippet, getSnippetBody } from "@/lib/library"

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export function regionHover(): Extension {
  return hoverTooltip(
    (view, pos) => {
      const r = regionAt(view.state, pos)
      if (!r) return null
      return {
        pos: r.from,
        end: r.to,
        above: true,
        create: () => {
          const text = view.state.doc.sliceString(r.from, r.to)
          const dom = el("div", "pi-hover")

          const head = el("div", "pi-hover-head")
          const dot = el("span", "pi-hover-dot")
          dot.style.background = flagColor(r.flag)
          const flag = el("span", "pi-hover-flag", r.flag)
          flag.style.color = flagColor(r.flag)
          head.append(dot, el("span", "pi-hover-name", r.name), flag)
          dom.append(head)

          if (r.note.trim().length > 0) {
            dom.append(el("div", "pi-hover-note", r.note))
          }

          // Same derived sync signal the Inspector uses: local edits beat
          // staleness — nothing is stored, everything compares live.
          const meta: string[] = [`${approxTokens(text)} tok`]
          if (r.snippetId) {
            const snip = getSnippet(r.snippetId)
            if (snip) {
              const canonical = getSnippetBody(r.snippetId)
              const status =
                canonical !== undefined && text !== canonical
                  ? "local edits"
                  : (r.syncedVersion ?? 0) < snip.version
                    ? "update available"
                    : "synced"
              meta.unshift(`⧉ ${snip.name} · ${status}`)
            }
          }
          dom.append(el("div", "pi-hover-meta", meta.join("  ·  ")))
          return { dom }
        },
      }
    },
    { hoverTime: 300 }
  )
}
