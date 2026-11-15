import { NextResponse } from 'next/server'
import { processQueuedBookingClosures } from '@/lib/agent/booking-closure-worker'
import { processBookingChangeWatches } from '@/lib/agent/booking-change-worker'
import { processPendingBookingScreenshots } from '@/lib/agent/booking-screenshot-worker'
import { processQueuedRestaurantReservations } from '@/lib/agent/restaurant-reservation-worker'
import { isCronAuthorized } from '@/lib/security/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 15 Nov audit: the shared, constant-time check (was a local copy with a plain ===).
const authorized = (request: Request) => isCronAuthorized(request)

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const [closures, screenshots, watches, restaurantReservations] = await Promise.all([
      processQueuedBookingClosures(),
      processPendingBookingScreenshots(),
      processBookingChangeWatches(),
      processQueuedRestaurantReservations(),
    ])
    return NextResponse.json({ ok: true, closures, screenshots, watches, restaurantReservations })
  } catch (err: any) {
    console.error('BOOKING_EVENT_CRON_FAILED:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'booking_event_worker_failed' }, { status: 500 })
  }
}