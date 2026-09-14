import { NextResponse } from 'next/server'
import { processDueLifeEventActions } from '@/lib/agent/life-event-worker'
import { processDueLifeEventEmailWatches } from '@/lib/agent/life-event-email-worker'
import { processDueLifeEventIntegrations } from '@/lib/agent/life-event-integration-worker'
import { syncUpcomingFlightTicketsToLifeEvents } from '@/lib/agent/travel-ticket-life-event-bridge'

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
    // First make the mature travel_tickets store part of the autonomous brain.
    // This backfills existing saved flights and adopts every newly parsed flight
    // before check-in/email/disruption lifecycle workers evaluate due actions.
    const flightTickets = await syncUpcomingFlightTicketsToLifeEvents()
    const email = await processDueLifeEventEmailWatches()
    // Run the concrete calendar/status/renewal integrations first so the legacy
    // worker never consumes these actions as generic "executor pending" work.
    const integrations = await processDueLifeEventIntegrations()
    const lifeEvents = await processDueLifeEventActions()
    return NextResponse.json({ ok: true, flightTickets, email, integrations, lifeEvents })
  } catch (err: any) {
    console.error('LIFE_EVENT_CRON_FAILED:', err?.message || err)
    return NextResponse.json({ ok: false, error: 'life_event_worker_failed' }, { status: 500 })
  }
}