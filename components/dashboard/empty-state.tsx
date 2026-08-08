import type { ReactNode } from 'react'

// ── The resting figure, only where there's nothing to look at ─────────────────
// The figure (a person sitting cross-legged, eyes closed) IS the product promise
// drawn: a quiet mind because something else holds the list. Per UI/UX brief §5
// it appears ONLY on empty / loading / welcome / run-out states — never as a
// persistent floating button, never per-row, never on a screen that already has
// content. When there's something to see, the figure steps back.
//
// Used bare (no logo ring / wordmark): that lockup is built for a 96px WhatsApp
// avatar and turns to mud smaller, and we're already inside a branded app.

type EmptyStateProps = {
  /** One calm line. Empty states get a message, never a blank surface. */
  message: string
  /** Optional secondary line (meta weight). */
  detail?: string
  /** Usually a <WhatsAppChip> or a single primary action. */
  action?: ReactNode
}

export function EmptyState({ message, detail, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      {/* Plain <img>: the figure is a small local asset; no optimization needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/gogo-figure.png" alt="" width={132} height={132} className="h-[132px] w-[132px] select-none" />
      <p className="text-base text-gogo-ink">{message}</p>
      {detail && <p className="-mt-2 text-[13px] text-gogo-ink/60">{detail}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
