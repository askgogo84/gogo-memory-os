import { NextResponse } from 'next/server'
import { processDueAgentWatchers } from '@/lib/agent/watchers'
import { compileUpcomingTravelWatchers } from '@/lib/agent/contextual-travel-watchers'
import { runFlightLegTracker } from '@/lib/agent/flight-leg-tracker'

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
  if (!authorized(request)) return NextResponse.json({ error:'unauthorized' }, { status:401 })
  try {
    const contextualTravel = await compileUpcomingTravelWatchers().catch((err:any)=>{
      console.error('CONTEXTUAL_TRAVEL_WATCHER_COMPILE_FAILED:',err?.message||err)
      return {users:0,created:0,reused:0,stopped:0,skipped:0,failed:1}
    })
    // Live per-flight tracking (take-off, landing, delays, gates) for trips being monitored.
    const flightTracker = await runFlightLegTracker().catch((err:any)=>{
      console.error('FLIGHT_LEG_TRACKER_FAILED:',err?.message||err)
      return {checked:0,sent:0,skipped:0,failed:1}
    })
    const result = await processDueAgentWatchers()
    return NextResponse.json({ ok:true, contextualTravel, flightTracker, ...result })
  } catch (err:any) {
    console.error('AGENT_WATCHER_CRON_FAILED:', err?.message || err)
    return NextResponse.json({ ok:false, error:'watcher_worker_failed' }, { status:500 })
  }
}
