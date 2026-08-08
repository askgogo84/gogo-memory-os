'use client'

import { useRouter } from 'next/navigation'

// ── A per-card failure, never a blank ─────────────────────────────────────────
// When a dashboard read fails, the surface shows THIS where the data would be —
// one calm line and a retry — while the rest of the page still renders (app-flow
// §8). A blank space or a zero would read as a fact ("you have nothing"); a read
// failure is not a fact, so it must look different. Retry re-runs the server
// component via router.refresh() — no full reload, no lost scroll.

export function CardError({ message }: { message?: string }) {
  const router = useRouter()
  return (
    <div className="rounded-2xl border border-gogo-ink/10 bg-gogo-surface p-5 text-center">
      <p className="text-sm text-gogo-ink/70">{message ?? 'Couldn’t load this right now.'}</p>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="mt-3 inline-flex min-h-9 items-center rounded-full border border-gogo-ink/15 px-4 text-sm font-semibold text-gogo-ink transition-colors duration-500 ease-calm hover:bg-gogo-ink/5"
      >
        Try again
      </button>
    </div>
  )
}
