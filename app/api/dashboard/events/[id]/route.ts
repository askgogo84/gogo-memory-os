import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { eventsEnabledFor } from '@/lib/events/core'
import { disableShareLink, EventsError, revokeGuest, rotateShareLink } from '@/lib/events/store'

export const dynamic = 'force-dynamic'

// Organizer actions from the event page: replace or switch off the shared link, remove a guest. Same-origin,
// signed-in owner only, and every store call is scoped to that owner. Moving and cancelling stay in chat, where Gogo
// asks for a confirmation that names the event.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = verifySameOrigin(request); if (blocked) return blocked
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const owner = String(session.telegramId)
  if (!eventsEnabledFor(owner)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  const { id } = await params
  const body = await request.json().catch(() => null) as { action?: unknown; guestId?: unknown } | null
  try {
    if (body?.action === 'new_link') return NextResponse.json({ ok: true, link: await rotateShareLink(owner, id) })
    if (body?.action === 'link_off') { await disableShareLink(owner, id); return NextResponse.json({ ok: true }) }
    if (body?.action === 'remove_guest' && typeof body.guestId === 'string') { await revokeGuest(owner, id, body.guestId); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  } catch (e) {
    const code = e instanceof EventsError ? e.code : 'failed'
    return NextResponse.json({ ok: false, error: code }, { status: code === 'not_found' ? 404 : code === 'changed_meanwhile' ? 409 : 500 })
  }
}
