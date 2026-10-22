'use client'

// Make v2 (Duet parity): the owner edits a saved result in place, refreshes it from its sources, and sees earlier
// versions. Saving sends only what changed; Gogo's later refreshes keep the sections marked "Edited by you".
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export type ReportSection = { title: string; text: string; edited: boolean }
export type ReportVersion = { at: string | null; by: 'owner' | 'gogo'; title: string }

function when(v: string | null) {
  if (!v || !Number.isFinite(Date.parse(v))) return 'Unknown time'
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(v))
}

const ERRORS: Record<string, string> = {
  changed_since_loaded: 'This result changed since you opened it. Reload the page and edit again.',
  nothing_to_change: 'Nothing changed.',
  unknown_section: 'A section changed since you opened it. Reload the page and edit again.',
  invalid_title: 'The title must be 1 to 180 characters.',
  invalid_notes: 'Notes can be up to 4,000 characters.',
  invalid_sections: 'Each section can be up to 20,000 characters.',
  body_too_large: 'That is too much text to save at once.',
}

export function ReportEditor({ id, title, notes, sections, refresh, versions, sources }: {
  id: string; title: string; notes: string; sections: ReportSection[]
  refresh: { ok: boolean; reason: string }; versions: ReportVersion[]; sources: { label: string; href?: string }[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title)
  const [draftNotes, setDraftNotes] = useState(notes)
  const [draft, setDraft] = useState(sections.map(s => s.text))
  const [busy, setBusy] = useState<'' | 'save' | 'refresh'>('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  function start() { setDraftTitle(title); setDraftNotes(notes); setDraft(sections.map(s => s.text)); setError(''); setStatus(''); setEditing(true) }
  function cancel() { setEditing(false); setError('') }

  async function save() {
    if (busy) return
    const body: Record<string, unknown> = {}
    if (draftTitle.trim() !== title) body.title = draftTitle
    if (draftNotes.trim() !== notes.trim()) body.notes = draftNotes
    const changed = sections.map((s, i) => ({ title: s.title, text: draft[i] })).filter((s, i) => s.text !== sections[i].text)
    if (changed.length) body.sections = changed
    if (!Object.keys(body).length) { setEditing(false); return }
    setBusy('save'); setError('')
    try {
      const res = await fetch(`/api/agent/artifacts/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(out?.error || res.status))
      setEditing(false); setStatus('Saved. Gogo will keep your edits when it refreshes this.')
      router.refresh()
    } catch (e: any) {
      setError(ERRORS[String(e?.message)] || 'Could not save that. Try once more.')
    } finally { setBusy('') }
  }

  async function runRefresh() {
    if (busy || !refresh.ok) return
    setBusy('refresh'); setError(''); setStatus('Refreshing from sources. This can take a few minutes.')
    try {
      const res = await fetch(`/api/agent/artifacts/${encodeURIComponent(id)}/refresh`, { method: 'POST', credentials: 'same-origin' })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) { setStatus(''); setError(String(out?.reason || 'Could not refresh this result. Try once more.')); return }
      setStatus(out?.status === 'completed' ? 'Refreshed. Your edited sections were kept.'
        : out?.status === 'waiting_approval' ? 'Gogo needs your approval before it continues. Check Needs you.'
        : 'Gogo could not finish the refresh. Check the task for the step that stopped.')
      router.refresh()
    } catch {
      setStatus(''); setError('Could not refresh this result. Try once more.')
    } finally { setBusy('') }
  }

  const btn = 'min-h-11 rounded-full px-4 text-[14px] font-medium disabled:opacity-50'
  return <div>
    {editing
      ? <label className="mt-5 block"><span className="text-[13px] text-[#9A9A9A]">Title</span>
          <input value={draftTitle} onChange={e => setDraftTitle(e.target.value)} maxLength={180}
            className="mt-1 min-h-11 w-full rounded-xl border border-[#2A2A2A] bg-[#111111] px-3 text-[16px] text-[#F2EFEA]"/></label>
      : <h1 className="mt-5 break-words font-serif text-3xl text-[#F2EFEA]">{title}</h1>}
    <p className="mt-2 text-[16px] text-[#9A9A9A]">Private report · visible only to your signed-in account</p>

    <div className="mt-4 flex flex-wrap items-center gap-2">
      {editing ? <>
        <button type="button" onClick={save} disabled={Boolean(busy)} className={`${btn} bg-[#2fb8a6] font-semibold text-[#04201c]`}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={cancel} disabled={Boolean(busy)} className={`${btn} border border-[#262626] bg-[#151515] text-[#f2efea]`}>Cancel</button>
      </> : <>
        <button type="button" onClick={start} disabled={Boolean(busy)} className={`${btn} border border-[#262626] bg-[#151515] text-[#f2efea]`}>Edit</button>
        <button type="button" onClick={runRefresh} disabled={Boolean(busy) || !refresh.ok} aria-describedby={refresh.ok ? undefined : 'refresh-reason'}
          className={`${btn} border border-[#262626] bg-[#151515] text-[#f2efea]`}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh from sources'}</button>
      </>}
    </div>
    {!refresh.ok && !editing && <p id="refresh-reason" className="mt-2 text-[13px] text-[#9A9A9A]">{refresh.reason}</p>}
    {status && <p className="mt-2 text-[13px] text-[#5fd3c3]" role="status">{status}</p>}
    {error && <p className="mt-2 text-[13px] text-[#d9a441]" role="alert">{error}</p>}

    {(editing || notes) && <section className="mt-6 rounded-xl border border-[#2A2A2A] p-5">
      <h2 className="text-lg font-semibold text-[#F2EFEA]">Your notes</h2>
      {editing
        ? <textarea value={draftNotes} onChange={e => setDraftNotes(e.target.value)} maxLength={4000} rows={4} aria-label="Your notes"
            className="mt-3 w-full rounded-xl border border-[#2A2A2A] bg-[#111111] p-3 text-[16px] leading-6 text-[#F2EFEA]"/>
        : <p className="mt-3 whitespace-pre-wrap break-words text-[16px] leading-6 text-[#F2EFEA]">{notes}</p>}
    </section>}

    {sections.length ? sections.map((section, index) => <section key={index} className="mt-6 rounded-xl border border-[#2A2A2A] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="break-words text-lg font-semibold text-[#F2EFEA]">{section.title}</h2>
        {section.edited && <span className="rounded-full bg-[#132a27] px-2.5 py-0.5 text-[12px] font-medium text-[#5fd3c3]">Edited by you</span>}
      </div>
      {editing
        ? <textarea value={draft[index]} onChange={e => setDraft(d => d.map((t, i) => i === index ? e.target.value : t))} maxLength={20000} rows={8}
            aria-label={`Edit ${section.title}`} className="mt-3 w-full rounded-xl border border-[#2A2A2A] bg-[#111111] p-3 text-[16px] leading-6 text-[#F2EFEA]"/>
        : <p className="mt-3 whitespace-pre-wrap break-words text-[16px] leading-6 text-[#F2EFEA]">{section.text}</p>}
    </section>) : <p className="mt-6 text-[#9A9A9A]">No completed source results were saved in this report.</p>}

    <section className="mt-6 rounded-xl border border-[#2A2A2A] p-5">
      <h2 className="text-lg font-semibold text-[#F2EFEA]">Sources</h2>
      {sources.length ? <ul className="mt-3 space-y-1">
        {sources.map((s, i) => <li key={i} className="break-all text-[14px] leading-6">
          {s.href ? <a href={s.href} target={s.href.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-[#2FB8A6] underline">{s.label}</a>
            : <span className="text-[#9A9A9A]">{s.label}</span>}
        </li>)}
      </ul> : <p className="mt-3 text-[14px] text-[#9A9A9A]">No sources were saved with this result.</p>}
    </section>

    <details className="mt-6 rounded-xl border border-[#2A2A2A] p-5">
      <summary className="flex min-h-11 cursor-pointer items-center text-lg font-semibold text-[#F2EFEA]">Earlier versions ({versions.length})</summary>
      {versions.length ? <ul className="mt-3 space-y-2">
        {versions.map((v, i) => <li key={i} className="text-[14px] leading-6 text-[#9A9A9A]">
          {when(v.at)} · {v.by === 'owner' ? 'Edited by you' : 'Made by Gogo'}{v.title && v.title !== title ? ` · “${v.title}”` : ''}
        </li>)}
      </ul> : <p className="mt-3 text-[14px] text-[#9A9A9A]">No earlier versions yet.</p>}
    </details>
  </div>
}
