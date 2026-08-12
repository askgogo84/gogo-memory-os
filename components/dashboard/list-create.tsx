'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

// ── Create a new list ─────────────────────────────────────────────────────────
// A collapsed "New list" affordance that reveals an inline name field. POSTs to
// /api/dashboard/lists, which REFUSES a duplicate name (409 → "already exists") rather
// than merging — the one behaviour that separates a Create button from the bot's
// append. NO optimistic UI: we wait for the server, then router.refresh() so the new
// (empty) list appears from the source of truth, not a guess.

export function ListCreate() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const working = busy || isPending

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || working) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const json = await res.json().catch(() => ({ ok: false }))
      if (!json.ok) {
        setError(json.error || 'Couldn’t create that list.')
        return
      }
      setName('')
      setOpen(false)
      startTransition(() => router.refresh())
    } catch {
      setError('Couldn’t create that list.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-gogo-ink/15 bg-gogo-surface px-4 text-[13px] font-semibold text-gogo-ink transition-colors duration-500 ease-calm hover:bg-gogo-ink/5"
      >
        <span aria-hidden className="text-[16px] leading-none text-gogo-ink-3">
          +
        </span>
        New list
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* autoFocus: the field is only mounted on demand, so focus lands where the
            user just tapped, not on page load. */}
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          disabled={working}
          autoFocus
          maxLength={60}
          placeholder="List name"
          aria-label="New list name"
          className="min-w-0 flex-1 rounded-[10px] border border-gogo-ink/15 bg-gogo-surface px-3 py-2 text-[14px] text-gogo-ink outline-none focus:border-gogo-ink/30"
        />
        <button
          type="submit"
          disabled={working || !name.trim()}
          className="inline-flex min-h-9 items-center rounded-full bg-gogo-ink px-4 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {working ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setName('')
            setError(null)
          }}
          disabled={working}
          className="inline-flex min-h-9 items-center px-2 text-[13px] font-semibold text-gogo-ink-3 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-[12.5px] text-gogo-orange-deep">{error}</p>}
    </form>
  )
}
