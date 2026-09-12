import { NextResponse } from 'next/server'
import { processQueuedBookingClosures } from '@/lib/agent/booking-closure-worker'
import { processBookingChangeWatches } from '@/lib/agent/booking-change-worker'
import { processPendingBookingScreenshots } from '@/lib/agent/booking-screenshot-worker'

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
    const [closures, screenshots, watches] = await Promise.all([
      processQueuedBookingClosures(),
      processPendingBookingScreenshots(),
      processBookingChangeWatches(),
    ])
    return NextResponse.json({ ok: true, closures, screenshots, watches })
  } catch (err: any) {
    console.error('BOOKING_EVENT_CRON_FAILED:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'booking_event_worker_failed' }, { status: 500 })
  }
}