import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { eventsEnabledFor } from '@/lib/events/core'
import { EventsError, getEvent, guestLink, headcount, listGuests, shareLink } from '@/lib/events/store'
import { whenText } from '@/lib/events/entry'
import { EventControls, GuestRemove, CopyLink, GoogleCalendarButton } from '@/components/dashboard/events/event-controls'

export const dynamic = 'force-dynamic'

const REPLY: Record<string, { label: string; cls: string }> = {
  going: { label: 'Going', cls: 'bg-[#101f1d] text-[#4cd0bd]' }, maybe: { label: 'Maybe', cls: 'bg-[#1a1710] text-[#d9a441]' },
  declined: { label: 'Declined', cls: 'bg-[#35221d] text-[#d96c5f]' }, none: { label: 'No reply', cls: 'bg-[#1a1512] text-[#c9a77c]' },
}

// AskGogo Events (approved mock 10 Nov, screen 4): one event, its headcount in people, guests and link controls.
// Everything shown is read from the store for this owner; nothing here messages a guest.
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  const owner = session ? String(session.telegramId) : ''
  if (!owner || !eventsEnabledFor(owner)) notFound()
  const { id } = await params
  let e: Awaited<ReturnType<typeof getEvent>>
  try { e = await getEvent(owner, id) } catch (err) { if (err instanceof EventsError && err.code === 'not_found') notFound(); throw err }
  const [h, guests, link] = await Promise.all([headcount(owner, e.id), listGuests(owner, e.id), shareLink(owner, e.id)])
  const live = e.status === 'published'
  const links = new Map<string, string | null>()
  await Promise.all(guests.filter(g => g.source === 'organizer' && !g.revoked).slice(0, 200).map(async g => { links.set(g.id, await guestLink(owner, e.id, g.id).catch(() => null)) }))
  const total = h.attendees + h.maybe + h.declined + h.no_reply || 1
  const pct = (n: number) => `${Math.round((n / Math.max(total, e.capacity || 0, 1)) * 100)}%`
  const shown = guests.filter(g => !g.revoked)
  return <div className="mx-auto w-full max-w-[720px] pb-10">
    <Link href="/dashboard/events" className="text-[14px] text-[#a8a8a4]">‹ Events</Link>
    <header className="pb-4 pt-2">
      <h1 className="final-dark-title text-[26px] sm:text-[30px]">{e.title}</h1>
      <p className="mt-1 text-[15px] text-[#a8a8a4]">{whenText(e.starts_at, e.timezone)}{e.venue_name ? ` · ${e.venue_name}` : ''}{e.status === 'cancelled' ? ' · Cancelled' : e.status === 'draft' ? ' · Draft' : ''}</p>
    </header>
    <section className="final-dark-card p-4">
      <div className="flex items-baseline gap-2"><span className="text-[40px] font-extrabold leading-none tracking-tight [font-variant-numeric:tabular-nums]">{h.attendees}</span><span className="text-[15px] text-[#a8a8a4]">{h.attendees === 1 ? 'person' : 'people'} coming{e.capacity ? `, of ${e.capacity}` : ''}</span></div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[#2e3a36]" aria-hidden="true">
        <i className="block h-full bg-[#4cd0bd]" style={{ width: pct(h.going) }}/><i className="block h-full bg-[#ef7a27]" style={{ width: pct(h.plus_ones) }}/><i className="block h-full bg-[#c9a77c]" style={{ width: pct(h.maybe) }}/>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[#c9c9c4] [font-variant-numeric:tabular-nums]">
        <span>{h.going} going</span><span>{h.plus_ones} plus-ones</span><span>{h.maybe} maybe</span><span>{h.declined} declined</span><span>{h.no_reply} no reply</span>
      </div>
    </section>
    {live && <section className="mt-3"><EventControls id={e.id} link={link}/></section>}
    {e.status === 'draft' && <p className="final-dark-card mt-3 p-4 text-[14px] text-[#a8a8a4]">This is a draft. Finish it in chat and say “publish” to get the invitation link.</p>}
    <section className="mt-5">
      <div className="final-dark-eyebrow mb-2">Guests · {shown.length}</div>
      {!shown.length && <p className="text-[14px] text-[#a8a8a4]">No guests yet. Forward the invitation link, or tell Gogo in chat who to add.</p>}
      <div className="final-dark-card divide-y divide-[#2e3a36] px-4">
        {shown.map(g => {
          const r = REPLY[g.rsvp] || REPLY.none, gl = links.get(g.id)
          return <div key={g.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">{g.name}</div>
              <div className="text-[13px] text-[#a8a8a4]">{[g.plusOnes ? `+${g.plusOnes}` : '', g.dietary, g.source === 'share_link' ? 'joined through the link' : 'added by you'].filter(Boolean).join(' · ')}</div>
              {g.comment && <div className="mt-0.5 text-[13px] text-[#c9c9c4]">“{g.comment}”</div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${r.cls}`}>{r.label}</span>
              {gl && live && <CopyLink link={gl} label="Link"/>}
              {e.status !== 'cancelled' && <GuestRemove id={e.id} guestId={g.id} name={g.name}/>}
            </div>
          </div>
        })}
      </div>
    </section>
    {e.starts_at && <GoogleCalendarButton id={e.id} revision={e.revision} when={whenText(e.starts_at, e.timezone)} remove={e.status === 'cancelled'}/>}
    {e.starts_at && e.status !== 'cancelled' && <a href={`/api/dashboard/events/${e.id}?format=ics`} className="mt-2 flex min-h-[44px] items-center justify-center px-4 text-[14px] font-semibold text-[#a8a8a4] underline">Or download a calendar file (Apple, Outlook)</a>}
    <p className="mt-5 text-[13px] text-[#8a8a86]">To move or cancel the event, tell Gogo in chat. It asks you to confirm first. After a change, tap Add to my Google Calendar again and the same entry is updated. If you cancel, you can remove it from your calendar here.</p>
  </div>
}
