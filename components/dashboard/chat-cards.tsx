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

// Morning brief card (v2 mock scene "Morning brief"): one line per topic, each starting with a chip. Amber = needs
// you, blue = Gogo has it. Tapping a chip opens a channel of that name when one exists, else asks Gogo about it.
export type BriefItemView = { topic: string; tone: 'needs_you' | 'handled'; text: string; href?: string }
export type BriefView = { date: string; items: BriefItemView[]; needsYou: number; artifactId?: string }

export function BriefCard({ brief, channels, onOpenChannel, onAsk }: { brief: BriefView; channels: { id: string; title: string }[]; onOpenChannel: (id: string) => void; onAsk: (text: string) => void }) {
  if (!brief.items.length) return null
  const chip = (tone: BriefItemView['tone']) => tone === 'needs_you' ? 'bg-[#3a2a10] text-[#e2b04a]' : 'bg-[#123d38] text-[#8be6d8]'
  const pick = (it: BriefItemView) => {
    const ch = channels.find(c => c.title.trim().toLowerCase() === it.topic.trim().toLowerCase())
    if (ch) onOpenChannel(ch.id); else onAsk(`Tell me more about ${it.topic.toLowerCase() === 'today' ? 'today' : `the ${it.topic} item in my brief`}`)
  }
  return <section aria-label="Morning brief" className="flex items-start gap-3 sm:gap-3.5" data-brief-card>
    <div className="w-10 shrink-0" aria-hidden="true"/>
    <div className="min-w-0 max-w-[90%] sm:max-w-[84%]">
      <div className="mb-1 flex items-center gap-2 text-[12.5px] text-[#a8a8a4]"><span className="grid h-[14px] w-[14px] place-items-center rounded-[4px] border border-[#a8a8a4] text-[10px]">✓</span>Morning brief{brief.needsYou ? ` · ${brief.needsYou} need${brief.needsYou === 1 ? 's' : ''} you` : ''}</div>
      <ul className="m-0 flex list-none flex-col gap-2.5 rounded-[18px] bg-[#161616] px-4 py-3.5 pl-4 text-[16px] leading-[1.6] text-[#dcdad5]">
        {brief.items.map((it, i) => <li key={i} className="flex gap-2">
          <span aria-hidden="true" className="text-[#6a6a6a]">•</span>
          <span className="min-w-0">
            <button type="button" onClick={() => pick(it)} className={`mr-1 inline-flex items-center gap-1.5 rounded-[8px] px-2 py-0.5 text-[15px] font-medium ${chip(it.tone)}`}>
              <span aria-hidden="true" className={`inline-block h-[9px] w-[9px] ${it.tone === 'needs_you' ? 'rounded-[2px] bg-current' : 'rounded-full border-[1.5px] border-current'}`}/>{it.topic}
            </button>
            <span>: {it.text}</span>
            {it.href && <Link href={it.href} className="ml-1 text-[14px] text-[#4cd0bd]">Open</Link>}
          </span>
        </li>)}
      </ul>
      {brief.artifactId && <Link href={`/dashboard/reports/${brief.artifactId}`} className="mt-1.5 inline-block text-[13px] text-[#a8a8a4]">Saved in Make</Link>}
    </div>
  </section>
}
