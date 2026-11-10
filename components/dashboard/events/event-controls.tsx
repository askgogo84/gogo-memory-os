'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

async function act(id: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/dashboard/events/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({ ok: false, error: `http_${r.status}` }))
  return j as { ok: boolean; error?: string; link?: string | null }
}

export function CopyLink({ link, label = 'Copy invitation link' }: { link: string; label?: string }) {
  const [done, setDone] = useState(false)
  return <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setDone(true); setTimeout(() => setDone(false), 1800) } catch { window.prompt('Copy this link', link) } }}
    className="min-h-[40px] rounded-[12px] border border-[#2e3a36] px-3 text-[13px] font-semibold">{done ? 'Copied' : label}</button>
}

/** The shared invitation link: copy it, replace it, or switch it off. Each change asks once on the page first. */
export function EventControls({ id, link }: { id: string; link: string | null }) {
  const router = useRouter()
  const [ask, setAsk] = useState<'rotate' | 'off' | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null)
  const run = async (action: 'rotate' | 'off') => {
    setBusy(true); setErr(null)
    const j = await act(id, { action: action === 'rotate' ? 'new_link' : 'link_off' }).catch(() => ({ ok: false, error: 'network' }))
    setBusy(false); setAsk(null)
    if (!j.ok) { setErr('That did not work, so nothing was changed. Please try again.'); return }
    router.refresh()
  }
  return <div className="final-dark-card p-4">
    <div className="text-[15px] font-semibold">Invitation link</div>
    <p className="mt-1 break-all text-[13px] text-[#a8a8a4]">{link || 'Switched off. Make a new one to invite more people.'}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {link && <CopyLink link={link}/>}
      {!ask && <button type="button" disabled={busy} onClick={() => setAsk('rotate')} className="min-h-[40px] rounded-[12px] border border-[#2e3a36] px-3 text-[13px] font-semibold">{link ? 'New link' : 'Make a new link'}</button>}
      {!ask && link && <button type="button" disabled={busy} onClick={() => setAsk('off')} className="min-h-[40px] rounded-[12px] border border-[#2e3a36] px-3 text-[13px] font-semibold">Switch off</button>}
    </div>
    {ask && <div className="mt-3 rounded-[12px] bg-[#1a1710] p-3 text-[14px]">
      <p>{ask === 'rotate' ? 'The current link will stop working. Guests who already replied keep their own links.' : 'Nobody new can reply through the link. Guests who already replied keep their own links.'}</p>
      <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => run(ask)} className="min-h-[40px] rounded-[12px] bg-[#ef7a27] px-4 text-[13px] font-bold text-[#1a0d04]">{busy ? 'Working…' : ask === 'rotate' ? 'Make new link' : 'Switch off'}</button>
        <button type="button" disabled={busy} onClick={() => setAsk(null)} className="min-h-[40px] rounded-[12px] border border-[#2e3a36] px-4 text-[13px] font-semibold">Keep it</button></div>
    </div>}
    {err && <p role="alert" className="mt-2 text-[13px] text-[#d96c5f]">{err}</p>}
  </div>
}

export function GuestRemove({ id, guestId, name }: { id: string; guestId: string; name: string }) {
  const router = useRouter()
  const [ask, setAsk] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(false)
  if (!ask) return <button type="button" aria-label={`Remove ${name}`} onClick={() => setAsk(true)} className="min-h-[40px] min-w-[40px] rounded-[12px] border border-[#2e3a36] px-2 text-[13px]">Remove</button>
  return <span className="flex items-center gap-1">
    <button type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(false); const j = await act(id, { action: 'remove_guest', guestId }).catch(() => ({ ok: false })); setBusy(false); if (j.ok) router.refresh(); else setErr(true) }}
      className="min-h-[40px] rounded-[12px] bg-[#a8372b] px-2 text-[13px] font-bold text-white">{busy ? '…' : err ? 'Retry' : 'Confirm'}</button>
    <button type="button" disabled={busy} onClick={() => setAsk(false)} className="min-h-[40px] rounded-[12px] border border-[#2e3a36] px-2 text-[13px]">Keep</button>
  </span>
}

const GCAL_TEXT: Record<string, string> = {
  not_connected: 'Your Google Calendar is not connected, so nothing was changed. Connect it in Connections, then try again.',
  changed_meanwhile: 'The event changed since this page loaded, so nothing was changed. The page has been refreshed: check it and try again.',
  has_guests: 'This entry in your Google Calendar has guests you added there, so Gogo left it alone. Change it in Google Calendar, so they are told.',
  not_there: 'It is not in your Google Calendar.', no_date: 'The event has no date yet, so it cannot go in your calendar.', cancelled: 'This event is cancelled.',
  unknown: 'Google did not confirm it, so I cannot be sure it worked. Check your calendar; tapping again is safe and will not make a second entry.',
}
const GCAL_DONE: Record<string, string> = { created: 'Added to your Google Calendar.', updated: 'Updated in your Google Calendar.', removed: 'Removed from your Google Calendar.' }

/** The organizer's own Google Calendar: add or update the entry, or remove it once the event is cancelled. Asks once on
 *  the page and says exactly what will happen. */
export function GoogleCalendarButton({ id, revision, when, remove = false }: { id: string; revision: number; when: string; remove?: boolean }) {
  const router = useRouter()
  const [ask, setAsk] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string; link?: string | null } | null>(null)
  const run = async () => {
    setBusy(true); setMsg(null)
    const j = await act(id, remove ? { action: 'remove_gcal' } : { action: 'add_gcal', revision }).catch(() => ({ ok: false, error: 'network' })) as any
    setBusy(false); setAsk(false)
    if (j.ok) { setMsg({ ok: true, text: `${GCAL_DONE[j.result] || 'Done.'}${j.changedSince ? ' The event changed while this ran: tap again to bring your calendar up to date.' : ''}`, link: j.link }); return }
    setMsg({ ok: false, text: GCAL_TEXT[j.result] || 'That did not work, so nothing was changed. Please try again.' })
    if (j.result === 'changed_meanwhile') router.refresh()
  }
  return <div className="final-dark-card mt-5 p-4">
    {!ask && <button type="button" disabled={busy} onClick={() => { setAsk(true); setMsg(null) }} className="flex min-h-[48px] w-full items-center justify-center rounded-[12px] border border-[#2e3a36] px-4 text-[15px] font-semibold">{remove ? 'Remove from my Google Calendar' : 'Add to my Google Calendar'}</button>}
    {ask && <div className="text-[14px]">
      <p>{remove
        ? 'Gogo will delete this event’s entry from your own Google Calendar. No one gets a message.'
        : `Gogo will put this event, ${when}, in your own Google Calendar. Nobody is invited and no one gets a message. If it is already there, its title, time, place and notes are updated; reminders and colours you set in Google stay.`}</p>
      <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={run} className="min-h-[40px] rounded-[12px] bg-[#ef7a27] px-4 text-[13px] font-bold text-[#1a0d04]">{busy ? 'Working…' : remove ? 'Remove it' : 'Add it'}</button>
        <button type="button" disabled={busy} onClick={() => setAsk(false)} className="min-h-[40px] rounded-[12px] border border-[#2e3a36] px-4 text-[13px] font-semibold">Not now</button></div>
    </div>}
    {msg && <p role="status" className={`mt-3 text-[14px] ${msg.ok ? 'text-[#4cd0bd]' : 'text-[#d9a441]'}`}>{msg.text}{msg.ok && msg.link ? <> <a href={msg.link} target="_blank" rel="noopener noreferrer" className="underline">Open it</a></> : null}{!msg.ok && /Connections/.test(msg.text) ? <> <a href="/dashboard/connections" className="underline">Go to Connections</a></> : null}</p>}
  </div>
}
