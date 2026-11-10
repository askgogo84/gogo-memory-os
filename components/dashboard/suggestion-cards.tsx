'use client'
// Tasks › Overview, "Suggested": things Gogo noticed that the owner might want to do next (Addendum 5, P1). Each card
// says what it is based on and can be dismissed. Nothing here does anything on its own.
import Link from 'next/link'
import { useState } from 'react'
import type { Suggestion } from '@/lib/events/next-steps'

export function SuggestionCards({ items }: { items: Suggestion[] }) {
  const [gone, setGone] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [failed, setFailed] = useState('')
  const shown = items.filter(s => !gone.includes(`${s.eventId}:${s.key}`))
  if (!shown.length) return null
  async function dismiss(s: Suggestion) {
    const id = `${s.eventId}:${s.key}`
    setBusy(id); setFailed('')
    try {
      const r = await fetch(`/api/dashboard/events/${encodeURIComponent(s.eventId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dismiss_suggestion', key: s.key }) })
      const j = await r.json().catch(() => ({ ok: false }))
      if (j?.ok) setGone(g => [...g, id]); else setFailed(id)
    } catch { setFailed(id) } finally { setBusy('') }
  }
  return <section aria-labelledby="own-suggested" className="flex flex-col gap-2">
    <div className="flex items-baseline justify-between"><h2 id="own-suggested" className="text-[17px] font-semibold text-[#f2efea]">Suggested</h2><span className="text-[13px] text-[#8a8a86]">{shown.length}</span></div>
    <p className="text-[13px] text-[#9a9a96]">Things Gogo noticed. Nothing has been done or sent; dismiss what you don’t need.</p>
    {shown.map(s => {
      const id = `${s.eventId}:${s.key}`
      return <div key={id} className="flex flex-col gap-1.5 rounded-[14px] border border-[#222] bg-[#121212] px-3.5 py-3">
        <span className="text-[15px] font-medium leading-snug text-[#f2efea]">{s.title}</span>
        <span className="text-[13px] leading-[1.45] text-[#9a9a96]">{s.why}</span>
        {failed === id && <span className="text-[13px] text-[#f0c26b]">Couldn’t dismiss this just now. Try again.</span>}
        <span className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => dismiss(s)} disabled={busy === id} className="min-h-11 rounded-[10px] px-3 text-[13px] font-semibold text-[#a8a8a4] disabled:opacity-60">{busy === id ? 'Dismissing…' : 'Dismiss'}</button>
          <Link href={s.href} className="flex min-h-11 items-center rounded-[10px] px-3 text-[13px] font-semibold text-[#77d2c4]">{s.action} →</Link>
        </span>
      </div>
    })}
  </section>
}
