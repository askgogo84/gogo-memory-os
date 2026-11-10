import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Picks up Meta webhook messages the webhook's own hand-over did not finish (a crash, a slow pipeline, a retry).
// Does nothing unless GOGO_WA_META_INBOX=1.
function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return bearer === expected
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { drainMetaInbox, metaInboxEnabled } = await import('@/lib/channels/whatsapp-provider/meta-inbox')
  if (!metaInboxEnabled()) return NextResponse.json({ ok: true, skipped: 'inbox_off' })
  try { return NextResponse.json({ ok: true, ...(await drainMetaInbox({ budgetMs: 100_000 })) }) }
  catch { console.error('WHATSAPP_META_INBOX_CRON_FAILED'); return NextResponse.json({ ok: false }, { status: 500 }) }
}
