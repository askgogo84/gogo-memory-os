// Resend "email.received" webhook for in.askgogo.in. Signed with RESEND_INBOUND_WEBHOOK_SECRET (whsec_…).
import { NextRequest, NextResponse } from 'next/server'
import { verifyResendWebhook, fetchReceivedEmail } from '@/lib/email/resend-inbound'
import { processInboundEmail } from '@/lib/email/inbound'
import { aliasFromAddress } from '@/lib/email/aliases'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const body = await req.text()
  const ok = verifyResendWebhook({
    secret: String(process.env.RESEND_INBOUND_WEBHOOK_SECRET || ''), body,
    id: String(req.headers.get('svix-id') || ''), timestamp: String(req.headers.get('svix-timestamp') || ''), signature: String(req.headers.get('svix-signature') || ''),
  })
  if (!ok) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  let event: any
  try { event = JSON.parse(body) } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }) }
  if (event?.type !== 'email.received' || !event?.data?.email_id) return NextResponse.json({ ok: true, ignored: true })
  const recipients: string[] = [...(event.data.received_for || []), ...(event.data.to || [])].map(String)
  const to = recipients.find(r => aliasFromAddress(r)) || ''
  // Mail for addresses that are not a Gogo alias is acknowledged and dropped without fetching its content.
  if (!to) return NextResponse.json({ ok: true, status: 'unknown_alias' })
  try {
    const { raw } = await fetchReceivedEmail(String(event.data.email_id))
    const result = await processInboundEmail({ to, from: String(event.data.from || ''), raw })
    return NextResponse.json({ ok: true, status: result.status })
  } catch (err: any) {
    console.error('RESEND_INBOUND_FAILED:', String(err?.message || err).slice(0, 200))
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}
