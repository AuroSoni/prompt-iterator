// Three-segment theme control: light / match-system / dark. Deliberately not a
// cycling single button — one click reaches any state, and the current state is
// readable without clicking, which a cycler can't manage.

import { Monitor, Moon, Sun } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { setTheme, useTheme, type ThemePref } from "@/lib/theme"
import { cn } from "@/lib/utils"

const OPTIONS: { pref: ThemePref; icon: LucideIcon; label: string }[] = [
  { pref: "light", icon: Sun, label: "Light" },
  { pref: "system", icon: Monitor, label: "Match system" },
  { pref: "dark", icon: Moon, label: "Dark" },
]

export function ThemeToggle({
  orientation = "horizontal",
  className,
}: {
  orientation?: "horizontal" | "vertical"
  className?: string
}) {
  const { pref, system } = useTheme()

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={cn(
        "inline-flex gap-0.5 rounded-md border p-0.5",
        orientation === "vertical" && "flex-col",
        className
      )}
    >
      {OPTIONS.map(({ pref: option, icon: Icon, label }) => {
        // "Match system" names what the OS currently reports — what you'd get
        // by picking it — not what's on screen now. Those differ whenever the
        // pref is an explicit light/dark.
        const title = option === "system" ? `Match system (${system})` : label
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={pref === option}
            aria-label={title}
            title={title}
            onClick={() => setTheme(option)}
            className={cn(
              "grid size-6 place-items-center rounded-[4px] transition-colors",
              pref === option
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
