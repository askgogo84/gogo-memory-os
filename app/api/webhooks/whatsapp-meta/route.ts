// Meta Cloud API webhook for the consumer AskGogo number (plan: docs/architecture/whatsapp-twilio-to-meta-migration.md).
// Off unless GOGO_META_WA_APP_SECRET, GOGO_META_WA_PHONE_ID and GOGO_META_WA_VERIFY_TOKEN are set.
//
// Each inbound message is checked against Meta's signature, then handed to the existing WhatsApp pipeline
// (/api/webhooks/whatsapp) in the field names it already reads, signed with the same server-side secret that
// pipeline already requires. The pipeline's own signature gate, idempotency, consent and routing are unchanged.
// A non-2xx from the pipeline makes this route answer 500 so Meta redelivers; the pipeline drops duplicates by id.
// This route sends nothing itself and downloads nothing itself.
//
// Known limits, acceptable for a pilot and to be closed before GOGO_WA_PROVIDER=meta for everyone:
//  - Forwarding is synchronous, so a slow turn makes Meta redeliver (harmless: duplicate ids are dropped) and a batch
//    of several slow messages can exceed maxDuration. The fix is a durable inbox with an immediate 200.
//  - A pilot person must write only to the Meta number: replies follow the person's provider, not the inbound number.
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { metaHandshakeChallenge, parseMetaWebhook, pipelineParams, verifyMetaSignature } from '@/lib/channels/whatsapp-provider/meta-inbound'
import { waProviderFor } from '@/lib/channels/whatsapp-provider/provider'
import { computeTwilioSignature } from '@/lib/security/webhook-signature'
import { deliveryRpc } from '@/lib/services/reminder-delivery'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const MAX_BODY_BYTES = 512 * 1024

export async function GET(req: NextRequest) {
  const challenge = metaHandshakeChallenge(new URL(req.url).searchParams, process.env.GOGO_META_WA_VERIFY_TOKEN)
  return challenge === null ? new NextResponse('Forbidden', { status: 403 }) : new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

/** Where the pipeline lives. Only ever a configured value, never derived from the request (a Host header must not be
 *  able to choose where a signed message is sent). Must be https and exactly the pipeline path. */
function pipelineUrl(): string | null {
  const configured = (process.env.TWILIO_WHATSAPP_WEBHOOK_URL || process.env.GOGO_WA_PIPELINE_URL || '').trim()
  try {
    const url = new URL(configured)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/webhooks/whatsapp') return null
    return url.toString()
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const declared = req.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared.trim()) || Number(declared) > MAX_BODY_BYTES)) return new NextResponse('Payload Too Large', { status: 413 })
  const raw = await req.text().catch(() => '')
  // Always strict, and first: an unsigned or wrongly signed body (or no configured secret) is a 403 and nothing else.
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), process.env.GOGO_META_WA_APP_SECRET)) return new NextResponse('Forbidden', { status: 403 })
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return new NextResponse('Payload Too Large', { status: 413 })
  let body: unknown
  try { body = JSON.parse(raw) } catch { return new NextResponse('Bad Request', { status: 400 }) }
  const parsed = parseMetaWebhook(body, process.env.GOGO_META_WA_PHONE_ID)
  console.log('WHATSAPP_META_INBOUND:', JSON.stringify({ messages: parsed.messages.length, statuses: parsed.statuses.length, ignored: parsed.ignored }))

  for (const s of parsed.statuses) {
    const key = createHash('sha256').update(JSON.stringify(['meta', s.id, s.status, s.errorCode])).digest('hex')
    try { await deliveryRpc('ingest_delivery_callback', { p_key: key, p_sid: s.id, p_status: s.status, p_error: s.errorCode || null, p_token: null, p_chunk: null, p_chunks: null }) }
    catch { return new NextResponse('Persistence unavailable', { status: 503 }) }
    try { await deliveryRpc('reconcile_delivery_receipt', { p_sid: s.id }) } catch { /* the minute worker reconciles the stored event */ }
  }

  if (!parsed.messages.length) return new NextResponse('', { status: 200 })
  const secret = process.env.TWILIO_AUTH_TOKEN || ''
  if (!secret) return new NextResponse('Pipeline unavailable', { status: 503 })
  const url = pipelineUrl()
  if (!url) { console.error('WHATSAPP_META_PIPELINE_URL_MISSING'); return new NextResponse('Pipeline unavailable', { status: 503 }) }
  for (const m of parsed.messages) {
    // Replies leave through whichever provider serves this person. If that is not Meta (the number is not in the
    // pilot and the switch is off), handling the message would answer from a different WhatsApp number, so it is skipped.
    if (waProviderFor(m.from) !== 'meta') { console.log('WHATSAPP_META_SENDER_NOT_ON_META:', JSON.stringify({ tail: m.from.slice(-4) })); continue }
    const params = pipelineParams(m)
    let status = 0, busy = false
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': computeTwilioSignature(secret, url, params) },
        body: new URLSearchParams(params).toString(),
        redirect: 'error', // never re-send the message and its signature to a redirect target
        signal: AbortSignal.timeout(110_000),
      })
      status = response.status
      // The pipeline's own 503 "Busy" is final: it has already told the person to send the message again, so a
      // redelivery here would run the same request twice. Any other failure asks Meta to redeliver.
      busy = status === 503 && (await response.text().catch(() => '')).trim() === 'Busy'
    } catch { status = 0 }
    if (busy) { console.log('WHATSAPP_META_PIPELINE_BUSY'); continue }
    if (status < 200 || status >= 300) {
      console.error('WHATSAPP_META_PIPELINE_FAILED:', JSON.stringify({ status }))
      return new NextResponse('Pipeline failed', { status: 500 })
    }
  }
  return new NextResponse('', { status: 200 })
}
