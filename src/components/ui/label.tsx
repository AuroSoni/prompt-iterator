import * as React from "react"

import { cn } from "@/lib/utils"

// A native <label> (with htmlFor it gives click-to-focus association) rather than
// the Radix primitive — the unified radix-ui package is reserved for components
// that genuinely need behavior (dropdown-menu, alert-dialog).
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm font-medium leading-none select-none",
        className
      )}
      {...props}
    />
  )
}

export { Label }
