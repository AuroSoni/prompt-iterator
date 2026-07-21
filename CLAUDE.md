# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product

A web-based authoring and comprehension environment for **long prompts** (3,000–5,000 tokens). The problem it solves is legibility, not performance: such a prompt is hard to hold in your head — you lose the skeleton, sections quietly contradict each other, you forget why a paragraph exists. This tool lets you see a prompt's shape, name and annotate its parts, promote parts into reusable snippets, and move between versions.

The output is always **text on the clipboard or a downloaded file**. Nothing depends on this being up.

### Hard boundaries (out of scope — do not build these)

- **Never calls an LLM.** No model execution, ever.
- No evaluation, benchmarking, scoring, or A/B testing.
- No runtime prompt-serving / read API. No backend fetches from here (the Nova Labs backend never reads from this tool).
- No multi-user collaboration, review workflows, or permissions.

These are product constraints, not TODOs. If a request seems to need one of them, stop and flag it rather than implementing it.

### Public repository

This repo is **public**. Do not commit secrets, internal URLs, customer data, or private Nova Labs details. Storage is Supabase (single-user; see README): only the publishable anon key may ever appear in client code — service-role keys and access tokens must never enter the repo. There is no server of our own and no LLM API key — a task appearing to need either is a signal it's out of scope.

## Commands

```bash
npm run dev      # Vite dev server with HMR
npm run build    # tsc -b (typecheck all project refs) then vite build
npm run lint     # oxlint — NOT eslint
npm run preview  # serve the production build locally
```

There is no test runner configured yet. `npm run build` is the typecheck gate (it runs `tsc -b` across the project references before bundling).

## Architecture & conventions

Client-only SPA. `index.html` → `src/main.tsx` → `src/App.tsx`. No router, state library, or backend at present; add them only when a feature needs them.

- **Path alias `@/*` → `src/*`.** Defined in **three** places that must stay in sync: `vite.config.ts`, `tsconfig.json`, and `tsconfig.app.json`. Always import internal modules with `@/…`.
- **TypeScript project references.** `tsconfig.json` is a solution file referencing `tsconfig.app.json` (app code, DOM libs) and `tsconfig.node.json` (Vite config). Strict flags are on: `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. `verbatimModuleSyntax` means **type-only imports must use `import type`**.
- **Tailwind CSS v4, CSS-first.** Configured via the `@tailwindcss/vite` plugin and `src/index.css` — there is **no `tailwind.config.js`**. Theme tokens live in `@theme inline` and `:root` / `.dark` blocks in `src/index.css` as oklch CSS variables. Add design tokens there, not in a JS config.
- **shadcn/ui.** Components are generated into `src/components/ui/` (config in `components.json`: style `radix-nova`, base color `neutral`, icon library `lucide-react`). Add new primitives with the shadcn CLI rather than hand-writing them. Compose class names with the `cn()` helper from [src/lib/utils.ts](src/lib/utils.ts) (`clsx` + `tailwind-merge`). Variants use `class-variance-authority` (see [button.tsx](src/components/ui/button.tsx) for the pattern: `cva` + `data-slot`/`data-variant` attributes).
- Dark mode is class-based (`.dark` on an ancestor, via the `@custom-variant dark` rule).

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
