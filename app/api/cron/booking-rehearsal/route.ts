import { NextResponse } from 'next/server'
import { runBookingRehearsal } from '@/lib/agent/booking-rehearsal'

// Internal cron: a public-pages rehearsal of the Playo booking flow that stops before Add To Cart.
// Self-disabling after REHEARSAL_UNTIL (see lib/agent/booking-rehearsal.ts).
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return bearer === expected
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const result = await runBookingRehearsal()
  return NextResponse.json({ ok: true, result })
}
