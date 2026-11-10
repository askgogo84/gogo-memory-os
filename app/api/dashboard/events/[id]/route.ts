import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { createHash } from 'node:crypto'
import { eventsEnabledFor, invitationIcs, publicInvitation } from '@/lib/events/core'
import { addEventToGoogleCalendar } from '@/lib/events/gcal'
import { disableShareLink, EventsError, getEvent, revokeGuest, rotateShareLink } from '@/lib/events/store'

export const dynamic = 'force-dynamic'

// Organizer actions from the event page: replace or switch off the shared link, remove a guest. Same-origin,
// signed-in owner only, and every store call is scoped to that owner. Moving and cancelling stay in chat, where Gogo
// asks for a confirmation that names the event.
/** The organizer's own calendar file (GET ?format=ics): the full details, with a stable id and the revision as its
 *  sequence, so importing it again after a change updates the same calendar entry instead of adding another. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const owner = String(session.telegramId)
  if (!eventsEnabledFor(owner) || new URL(request.url).searchParams.get('format') !== 'ics') return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const { id } = await params
  try {
    const e = await getEvent(owner, id)
    const view = publicInvitation({ ...e, address_visibility: 'everyone' }, null)
    const ics = invitationIcs(view, createHash('sha256').update(`organizer:${e.id}`).digest('hex').slice(0, 32), new Date(), e.revision)
    if (!ics) return NextResponse.json({ ok: false, error: 'no_date' }, { status: 404 })
    return new NextResponse(ics, { status: 200, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="event.ics"' } })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof EventsError ? err.code : 'failed' }, { status: err instanceof EventsError && err.code === 'not_found' ? 404 : 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = verifySameOrigin(request); if (blocked) return blocked
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const owner = String(session.telegramId)
  if (!eventsEnabledFor(owner)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const { id } = await params
  const body = await request.json().catch(() => null) as { action?: unknown; guestId?: unknown; revision?: unknown } | null
  try {
    if (body?.action === 'new_link') return NextResponse.json({ ok: true, link: await rotateShareLink(owner, id) })
    if (body?.action === 'link_off') { await disableShareLink(owner, id); return NextResponse.json({ ok: true }) }
    // The organizer's own Google Calendar, after the on-page confirm. The revision is the one the organizer saw.
    if (body?.action === 'add_gcal' && typeof body.revision === 'number') {
      const r = await addEventToGoogleCalendar(owner, id, body.revision)
      return NextResponse.json(r, { status: r.ok ? 200 : r.result === 'changed_meanwhile' ? 409 : r.result === 'unknown' ? 502 : r.result === 'failed' ? 502 : 400 })
    }
    if (body?.action === 'remove_guest' && typeof body.guestId === 'string') { await revokeGuest(owner, id, body.guestId); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  } catch (e) {
    const code = e instanceof EventsError ? e.code : 'failed'
    return NextResponse.json({ ok: false, error: code }, { status: code === 'not_found' ? 404 : code === 'changed_meanwhile' ? 409 : 500 })
  }
}
