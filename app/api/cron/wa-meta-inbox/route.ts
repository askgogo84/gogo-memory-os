import { NextResponse } from 'next/server'
import { isCronBearerAuthorized } from '@/lib/security/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Picks up Meta webhook messages the webhook's own hand-over did not finish (a crash, a slow pipeline, a retry).
// Does nothing unless GOGO_WA_META_INBOX is 1 or drain.
// 15 Nov audit: the shared, constant-time check (was a local copy with a plain ===).
const authorized = (request: Request) => isCronBearerAuthorized(request)

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { drainMetaInbox, metaInboxDraining } = await import('@/lib/channels/whatsapp-provider/meta-inbox')
  // GOGO_WA_META_INBOX=1: on. =drain: the webhook no longer stores, this keeps emptying what is stored. Unset: nothing.
  if (!metaInboxDraining()) return NextResponse.json({ ok: true, skipped: 'inbox_off' })
  try { return NextResponse.json({ ok: true, ...(await drainMetaInbox()) }) }
  catch { console.error('WHATSAPP_META_INBOX_CRON_FAILED'); return NextResponse.json({ ok: false }, { status: 500 }) }
}
