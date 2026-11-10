// AskGogo Events: the public RSVP endpoint. No account: the private link in the path is the only credential, so the
// handler does nothing unless that token resolves, and it returns only what that one guest may see.
// GET ?format=ics returns a calendar file. POST records an answer.
import { NextResponse } from 'next/server'
import { invitationIcs, rsvpErrorText } from '@/lib/events/core'
import { EventsError, invitationFor, isEventToken, submitRsvp } from '@/lib/events/store'

export const dynamic = 'force-dynamic'
const PRIVATE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }
const notFound = () => NextResponse.json({ ok: false, error: rsvpErrorText('not_found') }, { status: 404, headers: PRIVATE })
const unavailable = () => NextResponse.json({ ok: false, error: 'Invitations are not available right now. Please try again shortly.' }, { status: 503, headers: PRIVATE })

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  if (!isEventToken(token)) return notFound()
  try {
    const found = await invitationFor(token)
    if (!found || !found.view) return notFound()
    if (new URL(request.url).searchParams.get('format') === 'ics') {
      const ics = invitationIcs(found.view, token.slice(0, 16))
      if (!ics) return notFound()
      return new NextResponse(ics, { status: 200, headers: { ...PRIVATE, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="invitation.ics"' } })
    }
    return NextResponse.json({ ok: true, mode: found.mode, invitation: found.view }, { headers: PRIVATE })
  } catch (error) { return error instanceof EventsError ? unavailable() : unavailable() }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  if (!isEventToken(token)) return notFound()
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared.trim()) || Number(declared) > 4096)) return NextResponse.json({ ok: false, error: 'That reply is too long.' }, { status: 413, headers: PRIVATE })
  const raw = await request.text().catch(() => '')
  if (raw.length > 4096) return NextResponse.json({ ok: false, error: 'That reply is too long.' }, { status: 413, headers: PRIVATE })
  let body: any = null
  try { body = JSON.parse(raw) } catch { body = null }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, error: rsvpErrorText('invalid_status') }, { status: 400, headers: PRIVATE })
  const text = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null)
  try {
    const result = await submitRsvp(token, { status: String(body.status || ''), plusOnes: Number.isInteger(body.plusOnes) ? body.plusOnes : 0, dietary: text(body.dietary, 120), comment: text(body.comment, 300), name: text(body.name, 80) })
    // After a share-link answer the guest continues on their own personal link.
    const next = result.personalToken || token
    const found = await invitationFor(next)
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 409
      const message = result.error === 'full' && result.placesLeft ? `Only ${result.placesLeft} place${result.placesLeft === 1 ? '' : 's'} left. Please reduce your party.` : rsvpErrorText(result.error)
      return NextResponse.json({ ok: false, error: message, personalToken: result.personalToken || null, invitation: found?.view || null }, { status, headers: PRIVATE })
    }
    return NextResponse.json({ ok: true, personalToken: result.personalToken || null, invitation: found?.view || null }, { headers: PRIVATE })
  } catch { return unavailable() }
}
