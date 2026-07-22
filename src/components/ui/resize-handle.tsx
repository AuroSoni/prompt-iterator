// A vertical drag handle for resizing an adjacent pane. Pointer capture keeps
// the whole gesture on this element (no document listeners, drags survive
// crossing the CM editor or Dockview), and pointerdown-preventDefault blocks
// both native text selection and editor focus steal — the same trick the
// status-bar buttons use with mousedown.

import { useRef, useState } from "react"

import { cn } from "@/lib/utils"

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n))

export function ResizeHandle({
  edge,
  value,
  min,
  max,
  maxFraction,
  defaultValue,
  onChange,
  label,
  className,
}: {
  /** Which side of its pane the handle sits on: "end" = right of the pane
   *  (dragging right grows it), "start" = left of the pane (mirrored). */
  edge: "start" | "end"
  value: number
  min: number
  max: number
  /** Extra cap as a fraction of the parent element's width, measured at
   *  pointerdown — keeps a stored-wide pane from squeezing a narrow slot. */
  maxFraction?: number
  /** Double-click / Enter reset target. */
  defaultValue: number
  /** commit=false while dragging (memory only); true on release/reset/keys. */
  onChange: (width: number, commit: boolean) => void
  label: string
  className?: string
}) {
  const drag = useRef<{ startX: number; startW: number; effMax: number } | null>(
    null
  )
  const [dragging, setDragging] = useState(false)

  const widthAt = (clientX: number) => {
    const d = drag.current
    if (!d) return value
    const delta = clientX - d.startX
    const raw = edge === "end" ? d.startW + delta : d.startW - delta
    return clamp(Math.round(raw), min, d.effMax)
  }

  const finish = (clientX: number) => {
    if (!drag.current) return
    const w = widthAt(clientX)
    drag.current = null
    setDragging(false)
    onChange(w, true)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={label}
      className={cn(
        "z-10 w-1 shrink-0 cursor-col-resize touch-none select-none transition-colors hover:bg-ring/40 focus-visible:bg-ring/40 focus-visible:outline-none",
        dragging && "bg-ring/60",
        className
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        // Capture can throw NotFoundError if the pointer vanished between
        // event and call (pen lift, device removal). The drag still works
        // while the pointer stays over the handle, so degrade instead of die.
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // no capture — pointermove/up on the element still drive the drag
        }
        const parent = e.currentTarget.parentElement
        const effMax = maxFraction && parent
          ? Math.min(max, parent.getBoundingClientRect().width * maxFraction)
          : max
        drag.current = { startX: e.clientX, startW: value, effMax }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (drag.current) onChange(widthAt(e.clientX), false)
      }}
      onPointerUp={(e) => finish(e.clientX)}
      onPointerCancel={(e) => finish(e.clientX)}
      // Defensive: if capture is torn away some other way, don't leave a
      // half-open gesture behind.
      onLostPointerCapture={() => {
        drag.current = null
        setDragging(false)
      }}
      onDoubleClick={() => onChange(defaultValue, true)}
      onKeyDown={(e) => {
        // Arrows move the HANDLE, not the width: on a "start" handle (left of
        // its pane) ArrowRight shrinks the pane.
        const dir = edge === "end" ? 1 : -1
        let next: number | null = null
        if (e.key === "ArrowRight") next = value + 16 * dir
        else if (e.key === "ArrowLeft") next = value - 16 * dir
        else if (e.key === "Home") next = min
        else if (e.key === "End") next = max
        else if (e.key === "Enter") next = defaultValue
        if (next === null) return
        e.preventDefault()
        onChange(clamp(Math.round(next), min, max), true)
      }}
    />
  )
}
