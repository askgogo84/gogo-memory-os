'use client'
// Chat cards (9 Nov, v2 mock scenes "Approval in chat" and "Work card"):
//   - InlineApprovals: the pending approval cards inside the conversation, the same card and the same decision route as
//     Tasks. Deciding here updates there. Nothing runs without the yes; expired cards are refused by the route.
//   - workCard: a reply that links to /dashboard/reports/<id> shows the made thing as a card (title · updated · open).
import Link from 'next/link'
import { useState } from 'react'
import { ApprovalCard, type ApprovalCardData } from '@/components/dashboard/approval-card'

/** Pure: the report ids a reply links to, in order, once each. */
export function reportIdsIn(text: string): string[] {
  const out: string[] = []
  for (const m of String(text || '').matchAll(/https?:\/\/app\.askgogo\.in\/dashboard\/reports\/([0-9a-f-]{36})\b/gi)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** Pure: the title a reply gives its made thing: the first non-empty line, unless it is a sentence. */
export function workTitleFrom(text: string): string {
  const first = String(text || '').split('\n').map(s => s.replace(/^[*_#\s]+|[*_\s]+$/g, '').trim()).find(Boolean) || ''
  return first.length > 2 && first.length <= 90 && !/[.!?]$/.test(first) ? first : 'What Gogo made'
}

export function WorkCards({ text, createdAt }: { text: string; createdAt?: string | null }) {
  const ids = reportIdsIn(text)
  if (!ids.length) return null
  const when = createdAt && Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : null
  const title = workTitleFrom(text)
  return <div className="mt-3 flex flex-col gap-2">
    {ids.map(id => <Link key={id} href={`/dashboard/reports/${id}`} className="flex items-center gap-3 rounded-[14px] border border-[#2a2a2a] bg-[#161616] p-3 hover:border-[#4cd0bd]">
      <div className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[10px] bg-[#1c1c1c] text-[#4cd0bd]" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
      </div>
      <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-semibold text-[#f2efea]">{title}</div><div className="text-[13px] text-[#a8a8a4]">{when ? `Made ${when}` : 'Made by Gogo'} · in Make</div></div>
      <span className="text-[#a8a8a4]" aria-hidden="true">›</span>
    </Link>)}
  </div>
}

type Decision = 'approve' | 'reject' | 'defer'

export function InlineApprovals({ approvals, onChanged }: { approvals: ApprovalCardData[]; onChanged?: (note: string) => void }) {
  const [busy, setBusy] = useState<string>('')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string>('')
  const live = approvals.filter(a => !hidden.has(a.id) && !a.deferredUntil)
  if (!live.length) return null
  const decide = async (a: ApprovalCardData, decision: Decision) => {
    setBusy(a.id); setError('')
    try {
      const r = await fetch(`/api/agent/approvals/${encodeURIComponent(a.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ decision }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j?.message || (j?.error === 'approval_expired' ? 'That card expired. Gogo will ask again if it still matters.' : "Couldn't record your decision. Try again from Tasks.")); return }
      let note = decision === 'defer' ? `Okay, not now. Gogo asks again later: ${a.title}` : decision === 'reject' ? `Won't do it: ${a.title}` : `Approved: ${a.title}`
      if (decision === 'approve' && a.runId) {
        const x = await fetch(`/api/agent/runs/${encodeURIComponent(a.runId)}/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: '{}' })
        const xj = await x.json().catch(() => ({}))
        note = xj?.text || (x.ok ? `Approved · ${xj?.status || 'running'}` : 'Approved. Gogo will run it from Tasks.')
      }
      setHidden(h => new Set([...h, a.id]))
      onChanged?.(note)
    } catch { setError("Couldn't reach AskGogo. Try again from Tasks.") }
    finally { setBusy('') }
  }
  return <div className="flex flex-col gap-3" data-inline-approvals>
    <div className="text-[12px] font-semibold uppercase tracking-[.08em] text-[#a8a8a4]">Needs you · {live.length}</div>
    {live.slice(0, 3).map(a => <div key={a.id} className="max-w-[96%] sm:max-w-[84%]"><ApprovalCard approval={a} busy={busy === a.id} onDecide={d => decide(a, d)}/></div>)}
    {live.length > 3 && <Link href="/dashboard/tasks" className="text-[14px] text-[#4cd0bd]">{live.length - 3} more in Tasks →</Link>}
    {error && <p role="alert" className="text-[13px] text-[#d96c5f]">{error}</p>}
  </div>
}
