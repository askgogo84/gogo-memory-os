'use client'
import { useState } from 'react'

type Fact = { id: string; text: string; from: string }

export function TasteList({ initial }: { initial: Fact[] }) {
  const [facts, setFacts] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function forget(id: string) {
    setBusy(id); setError('')
    try {
      const res = await fetch('/api/dashboard/taste', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forget: id }) })
      if (!res.ok && res.status !== 404) throw new Error(String(res.status))
      setFacts(f => f.filter(x => x.id !== id))
    } catch { setError('Couldn’t forget that just now. Try again.') }
    finally { setBusy(null) }
  }

  if (!facts.length) return <p className="border-t border-[#1f1f1f] py-4 text-[15px] text-[#9a9a9a]">Nothing saved. Gogo will ask before it suggests.</p>
  return <div>
    {error ? <p role="alert" className="mb-2 text-[14px] text-[#d96c5f]">{error}</p> : null}
    <ul>
      {facts.map(f => <li key={f.id} className="flex items-start gap-3 border-t border-[#1f1f1f] py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-medium text-[#f2efea]">{f.text}</div>
          <div className="mt-0.5 text-[13px] text-[#7a7a7a]">{f.from}</div>
        </div>
        <button type="button" onClick={() => forget(f.id)} disabled={busy === f.id} aria-label={`Forget ${f.text}`}
          className="min-h-[44px] min-w-[72px] rounded-full border border-[#2f2f2f] px-3 text-[13px] font-medium text-[#f2efea] hover:border-[#6a6a6a] disabled:opacity-50">
          {busy === f.id ? 'Forgetting…' : 'Forget'}
        </button>
      </li>)}
    </ul>
  </div>
}
