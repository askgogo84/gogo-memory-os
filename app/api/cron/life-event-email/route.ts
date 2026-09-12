import { NextResponse } from 'next/server'
import { processDueLifeEventEmailWatches } from '@/lib/agent/life-event-email-worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const url = new URL(request.url)
  const query = url.searchParams.get('secret')
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return query === expected || bearer === expected
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const result = await processDueLifeEventEmailWatches()
    return NextResponse.json({ ok: true, ...result })
  } catch (error: any) {
    console.error('LIFE_EVENT_EMAIL_CRON_FAILED:', error?.message || error)
    return NextResponse.json({ ok: false, error: 'life_event_email_worker_failed' }, { status: 500 })
  }
}
