'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// ── Sign out ──────────────────────────────────────────────────────────────────
// The one non-read control in Phase 5b, and it authors no new write: it calls the
// EXISTING DELETE /api/dashboard/session (built in Phase 2), which deletes the
// session row server-side and expires the cookie. On success we land on the public
// redeemer (/dashboard), which now reads as the expired/signed-out screen.
//
// Not a <form> and not a data mutation — a button that hits the pre-built auth
// endpoint. Rendered as the design's quiet centered "Sign out" text.
export function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    if (busy) return
    setBusy(true)
    try {
      await fetch('/api/dashboard/session', { method: 'DELETE' })
    } catch {
      // Even if the request fails, fall through to the redeemer — a stale cookie
      // resolves to no session there. Never leave the user stuck on a dead button.
    }
    router.replace('/dashboard')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="mx-auto mt-3.5 mb-6 block text-[13.5px] font-semibold text-gogo-ink-3 transition-opacity duration-300 ease-calm disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
