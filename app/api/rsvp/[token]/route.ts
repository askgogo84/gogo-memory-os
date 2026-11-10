// AskGogo Events: the public RSVP endpoint. No account: the private link in the path is the only credential, so the
// handler does nothing unless that token resolves, and it returns only what that one guest may see.
// GET ?format=ics returns a calendar file. POST records an answer. Requests are bounded per address and per link.
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { invitationIcs, rsvpErrorText } from '@/lib/events/core'
import { invitationFor, isEventToken, rateOk, submitRsvp } from '@/lib/events/store'

export const dynamic = 'force-dynamic'
const MAX_BODY_BYTES = 4096
const PRIVATE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: PRIVATE })
const notFound = () => json({ ok: false, error: rsvpErrorText('not_found') }, 404)
const unavailable = () => json({ ok: false, error: 'Invitations are not available right now. Please try again shortly.' }, 503)
const slowDown = () => json({ ok: false, error: 'Too many tries. Please wait a few minutes and try again.' }, 429)
const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex')

/** Buckets are hashes: neither the address nor the link is stored in the counter table. */
function buckets(request: Request, token: string) {
  const address = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64) || 'unknown'
  return { byAddress: `ip:${sha(address).slice(0, 40)}`, byLink: `tk:${sha(token).slice(0, 40)}` }
}

/** Reads at most MAX_BODY_BYTES, whatever Content-Length says (or does not say). Null when larger. */
async function boundedBody(request: Request): Promise<string | null> {
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared.trim()) || Number(declared) > MAX_BODY_BYTES)) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    size += value.byteLength
    if (size > MAX_BODY_BYTES) { await reader.cancel().catch(() => {}); return null }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  if (!isEventToken(token)) return notFound()
  try {
    if (!(await rateOk(buckets(request, token).byAddress, 120, 600))) return slowDown()
    const found = await invitationFor(token)
    if (!found || !found.view) return notFound()
    if (new URL(request.url).searchParams.get('format') === 'ics') {
      // The calendar entry's id is a hash: no part of the private link is copied into anyone's calendar.
      const ics = invitationIcs(found.view, sha(`ics:${token}`).slice(0, 32))
      if (!ics) return notFound()
      return new NextResponse(ics, { status: 200, headers: { ...PRIVATE, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="invitation.ics"' } })
    }
    return json({ ok: true, mode: found.mode, invitation: found.view })
  } catch { return unavailable() }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  if (!isEventToken(token)) return notFound()
  try {
    const raw = await boundedBody(request)
    if (raw === null) return json({ ok: false, error: 'That reply is too long.' }, 413)
    let body: any = null
    try { body = JSON.parse(raw) } catch { body = null }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: rsvpErrorText('invalid_status') }, 400)
    const b = buckets(request, token)
    if (!(await rateOk(b.byAddress, 30, 600)) || !(await rateOk(b.byLink, 120, 600))) return slowDown()
    const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 600) : null)
    const result = await submitRsvp(token, { status: String(body.status || ''), plusOnes: Number.isInteger(body.plusOnes) ? body.plusOnes : 0, dietary: text(body.dietary), comment: text(body.comment), name: text(body.name), clientKey: text(body.clientKey) })
    if (!result.ok) {
      if (result.error === 'not_found') return notFound()
      const message = result.error === 'full' && result.placesLeft ? `Only ${result.placesLeft} place${result.placesLeft === 1 ? '' : 's'} left. Please reduce your party.`
        : result.error === 'invalid_client_key' ? 'Please reload this page and try again.' : rsvpErrorText(result.error)
      return json({ ok: false, error: message, gone: result.error === 'revoked' }, result.error === 'invalid_status' || result.error === 'name_required' || result.error === 'invalid_client_key' ? 400 : 409)
    }
    // After a share-link answer the guest's own row is reached through their personal token.
    const found = await invitationFor(result.personalToken || token)
    return json({ ok: true, personalToken: result.personalToken || null, invitation: found?.view || null })
  } catch { return unavailable() }
}
