// Forwarded mail arrives here from the Cloudflare Email Worker (see docs/email/forwarding-setup.md).
// Auth: shared secret header. Body: { to, from, raw } where raw is the full RFC 822 message (base64).
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { processInboundEmail } from '@/lib/email/inbound'

export const maxDuration = 30
const MAX_RAW = 8 * 1024 * 1024

function authorised(req: NextRequest) {
  const want = Buffer.from(String(process.env.EMAIL_INBOUND_SECRET || ''))
  const got = Buffer.from(String(req.headers.get('x-askgogo-inbound-secret') || ''))
  return want.length >= 24 && want.length === got.length && timingSafeEqual(want, got)
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }) }
  const to = String(body?.to || '').slice(0, 320)
  const rawB64 = String(body?.raw || '')
  if (!to || !rawB64) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  if (rawB64.length > MAX_RAW * 1.4) return NextResponse.json({ error: 'too_large' }, { status: 413 })
  const raw = Buffer.from(rawB64, 'base64').toString('latin1')
  try {
    const result = await processInboundEmail({ to, from: String(body?.from || ''), raw })
    // Unknown addresses are accepted silently so senders cannot probe which aliases exist.
    return NextResponse.json({ ok: true, status: result.status })
  } catch (err: any) {
    console.error('INBOUND_EMAIL_FAILED:', String(err?.message || err).slice(0, 200))
    // 500 makes the Worker reject the message so the sender's server retries later.
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}
