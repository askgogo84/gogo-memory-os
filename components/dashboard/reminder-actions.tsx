'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

// ── Edit / delete for one upcoming reminder ───────────────────────────────────
// A client leaf mounted under each UPCOMING thread node (never past/collapsed ones).
// Interaction only — identity and the write live server-side (the session-scoped
// routes under /api/dashboard/reminders/[id]). Three states: idle actions, an inline
// two-step delete confirm (NOT a browser confirm() — that looks broken on mobile and
// can't be styled), and an inline edit form. NO optimistic UI: we wait for the server,
// then router.refresh() re-reads the truth — a screen whose whole job is telling the
// user what's true must never show a tick that silently rolls back.
//
// EDIT is offered only when !isRecurring. Repeating reminders are delete-only (the
// server refuses their edits too, as defense in depth).

// Strip a leading "to " so the edit field shows what the thread shows ("call Amma",
// not "to call Amma"). Mirrors cleanLabel in lib/dashboard/thread.ts.
function cleanLabel(message: string): string {
  return message.replace(/^to\s+/i, '').trim()
}

// The row's time as "HH:mm" in the user's zone, to prefill the <input type="time">.
function timeInTz(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const h = parts.find(p => p.type === 'hour')?.value ?? '00'
  const m = parts.find(p => p.type === 'minute')?.value ?? '00'
  return `${h}:${m}`
}

type Mode = 'idle' | 'confirmDelete' | 'confirmStop' | 'editing'

export function ReminderActions({
  id,
  isRecurring,
  messageRaw,
  remindAtIso,
  tz,
}: {
  id: string
  isRecurring: boolean
  messageRaw: string
  remindAtIso: string
  tz: string
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [busy, setBusy] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [label, setLabel] = useState(() => cleanLabel(messageRaw))
  const [time, setTime] = useState(() => timeInTz(remindAtIso, tz))

  const working = busy || isPending

  async function onDelete() {
    if (working) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({ ok: false }))
      if (!json.ok) {
        setError('Couldn’t delete that. Try again.')
        return
      }
      // Success: the row leaves the thread on refresh. Keep `working` true through the
      // refresh so the buttons stay disabled and can't double-fire.
      startTransition(() => router.refresh())
    } catch {
      setError('Couldn’t delete that. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // Recurring-only: skip THIS occurrence (series continues) or stop the whole series.
  // Both hit POST /api/dashboard/reminders/[id] with an { action } body, mirroring the
  // WhatsApp skip/cancel via the same shared server primitives.
  async function onSeriesAction(action: 'skip' | 'stop') {
    if (working) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/reminders/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json().catch(() => ({ ok: false }))
      if (!json.ok) {
        setError(action === 'stop' ? 'Couldn’t stop that. Try again.' : 'Couldn’t skip that. Try again.')
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError(action === 'stop' ? 'Couldn’t stop that. Try again.' : 'Couldn’t skip that. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function onSaveEdit() {
    if (working) return
    const trimmed = label.trim()
    if (!trimmed) {
      setError('A reminder needs some text.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/reminders/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, time }),
      })
      const json = await res.json().catch(() => ({ ok: false }))
      if (!json.ok) {
        setError(json.error || 'Couldn’t save that. Try again.')
        return
      }
      setMode('idle')
      startTransition(() => router.refresh())
    } catch {
      setError('Couldn’t save that. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'editing') {
    return (
      <div className="mt-2 flex flex-col gap-2">
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          disabled={working}
          className="w-full rounded-[10px] border border-gogo-ink/15 bg-gogo-surface px-3 py-2 text-[14px] text-gogo-ink outline-none focus:border-gogo-ink/30"
          aria-label="Reminder text"
        />
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            disabled={working}
            className="rounded-[10px] border border-gogo-ink/15 bg-gogo-surface px-3 py-2 text-[14px] tabular-nums text-gogo-ink outline-none focus:border-gogo-ink/30"
            aria-label="Reminder time"
          />
          <button
            type="button"
            onClick={onSaveEdit}
            disabled={working}
            className="inline-flex min-h-9 items-center rounded-full bg-gogo-ink px-4 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {working ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('idle')
              setError(null)
              setLabel(cleanLabel(messageRaw))
              setTime(timeInTz(remindAtIso, tz))
            }}
            disabled={working}
            className="inline-flex min-h-9 items-center px-2 text-[13px] font-semibold text-gogo-ink-3 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-[12.5px] text-gogo-orange-deep">{error}</p>}
      </div>
    )
  }

  if (mode === 'confirmDelete') {
    return (
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[12.5px] font-medium text-gogo-ink-2">Delete this reminder?</span>
        <button
          type="button"
          onClick={onDelete}
          disabled={working}
          className="inline-flex min-h-9 items-center rounded-full bg-gogo-ink px-4 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {working ? 'Deleting…' : 'Delete'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('idle')
            setError(null)
          }}
          disabled={working}
          className="inline-flex min-h-9 items-center px-2 text-[13px] font-semibold text-gogo-ink-3 disabled:opacity-50"
        >
          Cancel
        </button>
        {error && <p className="text-[12.5px] text-gogo-orange-deep">{error}</p>}
      </div>
    )
  }

  if (mode === 'confirmStop') {
    return (
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[12.5px] font-medium text-gogo-ink-2">Stop this repeating reminder for good?</span>
        <button
          type="button"
          onClick={() => onSeriesAction('stop')}
          disabled={working}
          className="inline-flex min-h-9 items-center rounded-full bg-gogo-ink px-4 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {working ? 'Stopping…' : 'Stop series'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('idle')
            setError(null)
          }}
          disabled={working}
          className="inline-flex min-h-9 items-center px-2 text-[13px] font-semibold text-gogo-ink-3 disabled:opacity-50"
        >
          Keep it
        </button>
        {error && <p className="text-[12.5px] text-gogo-orange-deep">{error}</p>}
      </div>
    )
  }

  // Recurring rows get Skip vs Stop instead of a single Delete: a lone Delete would
  // silently end the whole series (the cron only spawns the next occurrence when the
  // current one fires, so deleting the pending row kills it). Skip advances one
  // occurrence; Stop ends the series. One-off rows keep Edit/Delete.
  if (isRecurring) {
    return (
      <div className="mt-1.5 flex items-center gap-4">
        <button
          type="button"
          onClick={() => onSeriesAction('skip')}
          disabled={working}
          className="text-[12.5px] font-semibold text-gogo-ink-3 hover:text-gogo-ink-2 disabled:opacity-50"
        >
          {working ? 'Skipping…' : 'Skip once'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('confirmStop')
            setError(null)
          }}
          disabled={working}
          className="text-[12.5px] font-semibold text-gogo-ink-3 hover:text-gogo-ink-2 disabled:opacity-50"
        >
          Stop
        </button>
        {error && <p className="text-[12.5px] text-gogo-orange-deep">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mt-1.5 flex items-center gap-4">
      <button
        type="button"
        onClick={() => {
          setMode('editing')
          setError(null)
        }}
        className="text-[12.5px] font-semibold text-gogo-ink-3 hover:text-gogo-ink-2"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={() => {
          setMode('confirmDelete')
          setError(null)
        }}
        className="text-[12.5px] font-semibold text-gogo-ink-3 hover:text-gogo-ink-2"
      >
        Delete
      </button>
    </div>
  )
}
