// Meta Cloud API webhook for the consumer AskGogo number (plan: docs/architecture/whatsapp-twilio-to-meta-migration.md).
// Off unless GOGO_META_WA_APP_SECRET, GOGO_META_WA_PHONE_ID and GOGO_META_WA_VERIFY_TOKEN are set.
//
// Each inbound message is checked against Meta's signature, then handed to the existing WhatsApp pipeline
// (/api/webhooks/whatsapp) in the field names it already reads, signed with the same server-side secret that
// pipeline already requires. The pipeline's own signature gate, idempotency, consent and routing are unchanged.
// A non-2xx from the pipeline makes this route answer 500 so Meta redelivers; the pipeline drops duplicates by id.
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { metaHandshakeChallenge, parseMetaWebhook, pipelineParams, verifyMetaSignature } from '@/lib/channels/whatsapp-provider/meta-inbound'
import { metaSend, metaTextPayload } from '@/lib/channels/whatsapp-provider/meta'
import { waProviderFor } from '@/lib/channels/whatsapp-provider/provider'
import { computeTwilioSignature } from '@/lib/security/webhook-signature'
import { deliveryRpc } from '@/lib/services/reminder-delivery'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const MAX_BODY_BYTES = 512 * 1024
const MEDIA_NOT_YET = "I can't open photos, voice notes or files on this number yet. Please type it for now."

export async function GET(req: NextRequest) {
  const challenge = metaHandshakeChallenge(new URL(req.url).searchParams, process.env.GOGO_META_WA_VERIFY_TOKEN)
  return challenge === null ? new NextResponse('Forbidden', { status: 403 }) : new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

function pipelineUrl(req: NextRequest): string {
  const configured = (process.env.TWILIO_WHATSAPP_WEBHOOK_URL || '').trim()
  return configured || `${new URL(req.url).origin}/api/webhooks/whatsapp`
}

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => '')
  if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return new NextResponse('Bad Request', { status: 400 })
  // Always strict: an unsigned or wrongly signed body is never parsed.
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), process.env.GOGO_META_WA_APP_SECRET)) return new NextResponse('Forbidden', { status: 403 })
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
  const url = pipelineUrl(req)
  for (const m of parsed.messages) {
    // Replies leave through whichever provider serves this person. If that is not Meta (the number is not in the
    // pilot and the switch is off), handling the message would answer from a different WhatsApp number, so it is skipped.
    if (waProviderFor(m.from) !== 'meta') { console.log('WHATSAPP_META_SENDER_NOT_ON_META:', JSON.stringify({ tail: m.from.slice(-4) })); continue }
    if (m.kind === 'media') {
      console.log('WHATSAPP_META_MEDIA_NOT_BRIDGED:', JSON.stringify({ type: m.mediaType }))
      try { await metaSend(metaTextPayload(m.from, MEDIA_NOT_YET, m.id)) } catch (error: any) { console.error('WHATSAPP_META_NOTICE_FAILED:', JSON.stringify({ status: error?.status || 0 })) }
      continue
    }
    const params = pipelineParams(m)
    let status = 0
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': computeTwilioSignature(secret, url, params) },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(110_000),
      })
      status = response.status
    } catch { status = 0 }
    if (status < 200 || status >= 300) {
      console.error('WHATSAPP_META_PIPELINE_FAILED:', JSON.stringify({ status }))
      return new NextResponse('Pipeline failed', { status: 500 })
    }
  }
  return new NextResponse('', { status: 200 })
}
