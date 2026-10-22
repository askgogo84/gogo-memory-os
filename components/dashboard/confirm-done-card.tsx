'use client'

// Duet parity (approved 22 Oct mock): Gogo finishing a task is "Gogo thinks this is done". Only the owner marks it
// complete; "Not yet" sends it back to Needs you with a one-tap way to say what is missing.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { GogoAgent } from '@/components/gogo/gogo-agent'
import type { FeedItem } from '@/lib/dashboard/task-feed'

export function ConfirmDoneCard({ item, size = 56 }: { item: FeedItem; size?: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'' | 'done' | 'not_done'>('')
  const [result, setResult] = useState<'' | 'done' | 'not_done'>('')
  const [error, setError] = useState('')
  const confirm = item.confirm!

  async function decide(decision: 'done' | 'not_done') {
    if (busy) return
    setBusy(decision); setError('')
    try {
      const res = await fetch(`/api/agent/runs/${encodeURIComponent(confirm.runId)}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ decision }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setResult(decision)
      router.refresh()
    } catch {
      setError('Could not save that. Try once more.')
    } finally {
      setBusy('')
    }
  }

  return <div className="flex items-start gap-3 rounded-[14px] border border-[#222] bg-[#121212] py-2 pl-1.5 pr-4">
    <span className="grid shrink-0 place-items-center" style={{ width: size + 4 }}><GogoAgent state={item.state} size={size}/></span>
    <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-1">
      <span className="flex items-start justify-between gap-3">
        <Link href={item.href} className="text-[15px] font-medium leading-snug text-[#f2efea] hover:underline">{item.title}</Link>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-[#132a27] px-2.5 py-0.5 text-[12px] font-medium text-[#5fd3c3]">{item.tag}</span>
      </span>
      {item.sub && <span className="line-clamp-2 text-[13px] leading-[1.45] text-[#9a9a96]">{item.sub}</span>}
      {result === 'done' && <span className="text-[13px] font-medium text-[#5fd3c3]" role="status">Marked complete by you.</span>}
      {result === 'not_done' && <span className="text-[13px] text-[#f0c26b]" role="status">Sent back. <Link href={confirm.continueHref} className="font-medium underline">Tell Gogo what’s missing →</Link></span>}
      {!result && <span className="flex flex-wrap items-center gap-2 pt-0.5">
        <button type="button" onClick={() => decide('done')} disabled={Boolean(busy)}
          className="min-h-11 rounded-full bg-[#2fb8a6] px-4 text-[14px] font-semibold text-[#04201c] disabled:opacity-50">{busy === 'done' ? 'Saving…' : 'Mark complete'}</button>
        <button type="button" onClick={() => decide('not_done')} disabled={Boolean(busy)}
          className="min-h-11 rounded-full border border-[#262626] bg-[#151515] px-4 text-[14px] font-medium text-[#f2efea] disabled:opacity-50">{busy === 'not_done' ? 'Saving…' : 'Not yet'}</button>
        <span className="text-[12px] text-[#c9a77c]">{item.live}</span>
      </span>}
      {error && <span className="text-[13px] text-[#d9a441]" role="alert">{error}</span>}
    </span>
  </div>
}
