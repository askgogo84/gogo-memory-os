import { NextResponse } from 'next/server'
import { processDueAgentWatchers } from '@/lib/agent/watchers'
import { compileUpcomingTravelWatchers } from '@/lib/agent/contextual-travel-watchers'
import { runFlightLegTracker, repairYearlessFlightLegs } from '@/lib/agent/flight-leg-tracker'
import { isCronAuthorized } from '@/lib/security/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 15 Nov audit: the shared, constant-time check (was a local copy with a plain ===).
const authorized = (request: Request) => isCronAuthorized(request)

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error:'unauthorized' }, { status:401 })
  try {
    // Date year-less boarding passes saved before that fix, so the steps below can follow them.
    const repairedLegs = await repairYearlessFlightLegs().catch((err:any)=>{
      console.error('FLIGHT_LEG_REPAIR_FAILED:',err?.message||err)
      return {repaired:0}
    })
    if (repairedLegs.repaired) console.log('FLIGHT_LEGS_REPAIRED:', repairedLegs.repaired)
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
    return NextResponse.json({ ok:true, repairedLegs, contextualTravel, flightTracker, ...result })
  } catch (err:any) {
    console.error('AGENT_WATCHER_CRON_FAILED:', err?.message || err)
    return NextResponse.json({ ok:false, error:'watcher_worker_failed' }, { status:500 })
  }
}
