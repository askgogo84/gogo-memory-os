'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DatedFact } from '@/lib/memory/dated-facts'

const field = 'block w-full rounded-lg border border-[#363636] bg-[#141414] p-2 text-[15px]'
const button = 'min-h-10 rounded-full border border-[#444] px-4 text-[14px] disabled:opacity-50'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

function Revision({ fact }: { fact: DatedFact }) {
  const row = fact.revision
  return <div className="mt-2 break-words">{row ? <>
    <p>{row.answer}</p>
    <p className="text-sm text-[#aaa]">{row.source} · Effective {row.effectiveOn} · Recorded {new Date(row.recordedAt).toLocaleString('en-IN')}</p>
  </> : <p>No revision applies on this date.</p>}</div>
}

export function DatedFacts({ workspace, canEdit = true }: { workspace: string | null; canEdit?: boolean }) {
  const [topic, setTopic] = useState('')
  const [day, setDay] = useState(today)
  const [lookup, setLookup] = useState<{ fact: DatedFact | null } | null>(null)
  const [brief, setBrief] = useState<DatedFact[]>([])
  const [answer, setAnswer] = useState('')
  const [source, setSource] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const generation = useRef(0)
  const requestId = useRef('')
  const call = useCallback(async (params: Record<string, unknown>) => {
    const res = await fetch('/api/dashboard/dated-facts', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, workspace }) })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || 'Could not load facts.')
    return body
  }, [workspace])

  useEffect(() => {
    if (!expanded) return
    let active = true
    async function refresh() {
      if (!active) return
      const seq = ++generation.current
      setLookup(null); setBrief([]); setConfirmForget(false); setBusy(false)
      if (document.hidden) return
      try {
        const result = await call({ action: 'brief', day: today() })
        if (active && seq === generation.current) setBrief(result.facts)
      } catch { if (active && seq === generation.current) setMessage('Could not verify your saved questions.') }
    }
    void refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => { active = false; ++generation.current; document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) }
  }, [expanded, call])

  function clearLookup() {
    ++generation.current
    setLookup(null); setMessage(''); setConfirmForget(false); setAnswer(''); setSource(''); requestId.current = ''
  }
  async function run(action: 'read' | 'save' | 'forget' | 'follow' | 'unfollow') {
    if (busy) return
    const seq = ++generation.current
    setBusy(true); setMessage(''); setConfirmForget(false)
    try {
      if (action !== 'read') {
        if (!lookup) throw new Error('Look up the topic first.')
        if (!requestId.current) requestId.current = crypto.randomUUID()
        await call({ action, topic, day, head: lookup.fact?.head ?? null, requestId: requestId.current, answer, source })
        requestId.current = ''
      }
      const [result, saved] = await Promise.all([call({ action: 'read', topic, day }), call({ action: 'brief', day: today() })])
      if (seq !== generation.current) return
      setLookup({ fact: result.facts[0] ?? null }); setBrief(saved.facts)
      if (action === 'save' || action === 'forget') { setAnswer(''); setSource('') }
      if (action !== 'read') setMessage(action === 'forget' ? 'Topic and history removed.' : 'Saved.')
    } catch (err) {
      if (seq !== generation.current) return
      setLookup(null); setBrief([]); setMessage(err instanceof Error ? err.message : 'Could not verify this topic.')
    } finally { if (seq === generation.current) setBusy(false) }
  }

  return <details className="final-dark-panel mt-5 p-4" onToggle={e => {
    const open = e.currentTarget.open
    if (!open) { clearLookup(); setBrief([]); setBusy(false) }
    setExpanded(open)
  }}>
    <summary className="cursor-pointer font-semibold">Dated facts and saved questions</summary>
    {expanded && <div className="mt-3 space-y-3">
      <p className="text-sm text-[#aaa]">{workspace ? 'Published revisions are visible to this workspace.' : 'These revisions are private to you.'} Ask in chat using “Fact: late checkout on 2026-11-30”.</p>
      {brief.length > 0 && <section><h3 className="font-semibold">Your saved questions today</h3>
        <ul>{brief.map(f => <li key={f.topic} className="mt-2"><strong>{f.topic}</strong><Revision fact={f}/></li>)}</ul></section>}
      <form className="grid gap-2 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); void run('read') }}>
        <label>Topic<input className={field} value={topic} disabled={busy} maxLength={100} required placeholder="Late checkout" onChange={e => { clearLookup(); setTopic(e.target.value) }}/></label>
        <label>Effective date<input type="date" className={field} value={day} disabled={busy} required onChange={e => { clearLookup(); setDay(e.target.value) }}/></label>
        <button className={button} disabled={busy}>Look up</button>
      </form>
      {lookup && <>
        {lookup.fact ? <><Revision fact={lookup.fact}/>
          <button type="button" className={button} disabled={busy} onClick={() => void run(lookup.fact?.following ? 'unfollow' : 'follow')}>
            {lookup.fact.following ? 'Remove from my brief' : 'Follow in my brief'}</button>
          {lookup.fact.following && <p className="select-all text-sm">Reminder command: Remind me tomorrow at 9 am to check saved fact {lookup.fact.id}</p>}</> : <p>No fact with this topic yet.</p>}
        {canEdit && <form className="space-y-2" onSubmit={e => { e.preventDefault(); void run('save') }}>
          <label>Answer effective {day}<input className={field} value={answer} maxLength={1000} required disabled={busy} onChange={e => { requestId.current = ''; setAnswer(e.target.value) }}/></label>
          <label>Source and revision reference<input className={field} placeholder="Guest policy, revision 4, section 2" value={source} maxLength={180} required disabled={busy} onChange={e => { requestId.current = ''; setSource(e.target.value) }}/></label>
          <button className={button} disabled={busy}>{workspace ? 'Publish revision to this workspace' : 'Save private revision'}</button>
        </form>}
        {canEdit && lookup.fact && <button className={button} disabled={busy} onClick={() => confirmForget ? void run('forget') : setConfirmForget(true)}>
          {confirmForget ? 'Confirm removal of all revisions and saved questions' : 'Remove topic and history'}</button>}
      </>}
      <p role="status" aria-live="polite">{busy ? 'Checking…' : message}</p>
    </div>}
  </details>
}
