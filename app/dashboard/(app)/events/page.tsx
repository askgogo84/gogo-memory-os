import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { eventsEnabledFor, type Headcount } from '@/lib/events/core'
import { EventsError, headcount, listEvents } from '@/lib/events/store'
import { whenText } from '@/lib/events/entry'

export const dynamic = 'force-dynamic'

// AskGogo Events (approved mock 10 Nov, screen 3): upcoming, draft and past events. Behind GOGO_EVENTS_OWNERS.
// Planning happens in chat; this page reads what the store holds and links to one event.
function state(e: { status: string; starts_at: string | null }, now: number) {
  if (e.status === 'cancelled') return { label: 'Cancelled', cls: 'bg-[#35221d] text-[#d96c5f]' }
  if (e.status === 'draft') return { label: 'Draft', cls: 'bg-[#1a1710] text-[#d9a441]' }
  if (e.starts_at && Date.parse(e.starts_at) < now) return { label: 'Past', cls: 'bg-[#1a1512] text-[#c9a77c]' }
  return { label: 'Open', cls: 'bg-[#101f1d] text-[#4cd0bd]' }
}

export default async function EventsPage() {
  const session = await getSession()
  const owner = session ? String(session.telegramId) : ''
  if (!owner || !eventsEnabledFor(owner)) notFound()
  const now = Date.now()
  let events: Awaited<ReturnType<typeof listEvents>> = [], setup = false, failed = false
  try { events = await listEvents(owner) } catch (e) { if (e instanceof EventsError && e.code === 'events_not_enabled') setup = true; else failed = true }
  const counts = new Map<string, Headcount>()
  await Promise.all(events.filter(e => e.status === 'published').slice(0, 12).map(async e => { try { counts.set(e.id, await headcount(owner, e.id)) } catch { /* shown without a count */ } }))
  const rank = (e: (typeof events)[number]) => (e.status === 'published' && !(e.starts_at && Date.parse(e.starts_at) < now) ? 0 : e.status === 'draft' ? 1 : 2)
  const sorted = [...events].sort((a, b) => rank(a) - rank(b) || Date.parse(a.starts_at || (a as any).created_at) - Date.parse(b.starts_at || (b as any).created_at))
  return <div className="mx-auto w-full max-w-[880px] pb-10">
    <header className="pb-5 lg:pt-4">
      <div className="final-dark-eyebrow">Events</div>
      <h1 className="final-dark-title mt-1.5 text-[28px] sm:text-[32px]">Your events</h1>
      <p className="mt-1.5 text-[15px] text-[#a8a8a4]">Plan them in chat. Gogo never messages your guests; you forward the invitation link.</p>
    </header>
    {setup && <p className="final-dark-card final-dark-amber mb-4 p-4 text-[14px]">Events storage isn&apos;t set up yet.</p>}
    {failed && <p className="final-dark-card final-dark-amber mb-4 p-4 text-[14px]">Your events could not be loaded just now. Please try again in a moment.</p>}
    {!setup && !failed && !sorted.length && <div className="final-dark-card p-5 text-[15px] text-[#a8a8a4]">No events yet. Try saying “Plan Divya&apos;s birthday on 22 November at 5 pm” in chat.</div>}
    <div className="grid grid-cols-1 gap-3">
      {sorted.map(e => {
        const s = state(e, now), h = counts.get(e.id)
        const going = h ? h.attendees : 0, cap = e.capacity || 0
        return <Link key={e.id} href={`/dashboard/events/${e.id}`} className="final-dark-card block p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 text-[16px] font-semibold">{e.title}</div>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${s.cls}`}>{s.label}</span>
          </div>
          <div className="mt-1 text-[14px] text-[#a8a8a4]">{whenText(e.starts_at, e.timezone)}{e.venue_name ? ` · ${e.venue_name}` : ''}</div>
          {e.status === 'draft' && <div className="mt-1 text-[14px] text-[#a8a8a4]">{!e.starts_at ? 'Needs a date and time' : !e.venue_name && !e.online_url ? 'Needs a place' : 'Ready to publish: say “publish” in chat'}</div>}
          {h && <>
            {cap > 0 && <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#2e3a36]" aria-hidden="true"><div className="h-full bg-[#4cd0bd]" style={{ width: `${Math.min(100, Math.round((going / cap) * 100))}%` }}/></div>}
            <div className="mt-2 text-[14px] text-[#c9c9c4] [font-variant-numeric:tabular-nums]">{going} {going === 1 ? 'person' : 'people'} coming{cap ? ` of ${cap}` : ''}{h.no_reply ? ` · ${h.no_reply} not replied` : ''}</div>
          </>}
        </Link>
      })}
    </div>
    <Link href="/dashboard/chat" className="mt-5 flex min-h-[48px] items-center justify-center rounded-[14px] bg-[#ef7a27] px-4 text-[15px] font-bold text-[#1a0d04]">Plan an event in chat</Link>
  </div>
}
